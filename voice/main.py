"""Memoria Voice Service — entry point."""

import argparse
import asyncio
import sys


def test_audio() -> None:
    """Record 5 seconds from the mic and play it back."""
    from config import cfg
    import audio_io

    sr = cfg["sample_rate"]
    ch = cfg["channels"]

    print("=== Audio devices ===")
    audio_io.list_devices()
    print()

    print(f"开始录音（5 秒）...  [sample_rate={sr}, channels={ch}]")
    audio = audio_io.record(seconds=5, sample_rate=sr, channels=ch)
    peak = audio.max()
    print(f"录音结束 — {len(audio)} samples, peak amplitude: {peak:.4f}")

    if peak < 0.001:
        print("⚠ 几乎没有检测到声音，请检查麦克风是否正常工作")

    print("播放中...")
    audio_io.play(audio, sample_rate=sr)
    print("测试完成 ✓")


# ----------------------------------------------------------------------
# Async talk loop
# ----------------------------------------------------------------------

async def wait_for_space(
    space_event: asyncio.Event,
    timeout: float | None,
) -> bool:
    """Wait for the space key.  Returns True if pressed, False on timeout.

    Caller must clear() the event beforehand if stale presses should be
    discarded (e.g. after PROCESSING).  We do NOT clear here so that a
    press during tone playback is not lost.
    """
    try:
        if timeout is None:
            await space_event.wait()
        else:
            await asyncio.wait_for(space_event.wait(), timeout)
        return True
    except asyncio.TimeoutError:
        return False


async def talk_loop() -> None:
    """Async space-to-talk loop: record → STT → AI chat → TTS → playback."""
    import keyboard
    from config import cfg
    from state_machine import StateMachine, State
    from vad import SileroVAD
    import audio_io
    from audio_io import REMIND_PATTERN, BYE_PATTERN
    from memoria_client import MemoriaClient
    from session import Session
    from stt import make_transcriber
    from pipeline import run_pipeline, ChatError

    sr = cfg["sample_rate"]
    silence_ms = int(cfg["silence_duration"] * 1000)
    max_sec = cfg["max_recording"]
    threshold = cfg["vad_threshold"]
    language = cfg["language"]
    idle_remind_m = cfg["idle_remind_m"]
    idle_remind_wait_s = cfg["idle_remind_wait_s"]
    tts_voice = cfg["tts_voice"]
    tts_speed = cfg.get("tts_speed", 1.0)

    sm = StateMachine()
    vad = SileroVAD(threshold=threshold)

    # Local STT: load model once, reuse across recordings (None = API mode)
    local_stt = make_transcriber(cfg["stt_provider"], cfg["stt_model"], language)
    client = MemoriaClient(
        base_url=cfg["memoria_url"],
        admin_token=cfg["admin_token"],
    )
    session = Session(client, timeout_m=cfg["session_timeout"])

    # Cancel event for pipeline (Step 6 barge-in will set this)
    cancel_event = asyncio.Event()

    # Bridge keyboard events → asyncio
    loop = asyncio.get_running_loop()
    space_event = asyncio.Event()
    keyboard.on_press_key("space", lambda _: loop.call_soon_threadsafe(space_event.set))

    # Pre-warm audio player + STT model in parallel
    warmup = [asyncio.to_thread(audio_io.get_tts_player, 24000)]
    if local_stt:
        warmup.append(asyncio.to_thread(local_stt.warm))
    await asyncio.gather(*warmup)

    print("=== Memoria Voice — Talk Mode ===")
    print("Press Space to talk, Ctrl+C to quit.\n")

    # Try creating initial conversation (non-fatal if server is down)
    try:
        await session.ensure_conversation()
    except Exception as e:
        print(f"Warning: 无法连接服务器 ({e})，稍后重试\n")

    try:
        while True:
            # ============================================================
            # IDLE — wait for space or idle timeout
            # ============================================================
            if sm.state == State.IDLE:
                idle_timeout = idle_remind_m * 60 if idle_remind_m > 0 else None
                space_event.clear()  # discard stale presses from PROCESSING
                print(f"[{sm.state.name}] Press Space to talk...")
                pressed = await wait_for_space(space_event, timeout=idle_timeout)

                if not pressed:
                    # Idle timeout → remind
                    print(f"[{sm.state.name}] 还在吗？")
                    await asyncio.to_thread(audio_io.play_tone_pattern, REMIND_PATTERN)
                    pressed = await wait_for_space(space_event, timeout=idle_remind_wait_s)
                    if not pressed:
                        # No response → sleep
                        print(f"[{sm.state.name}] 晚安～")
                        await asyncio.to_thread(audio_io.play_tone_pattern, BYE_PATTERN)
                        sm.transition(State.SLEEPING)
                        continue

                # Space pressed → ensure conversation exists
                try:
                    await session.ensure_conversation()
                except Exception as e:
                    print(f"Error: 创建对话失败 ({e})")

                # Start listening
                sm.transition(State.LISTENING)
                await asyncio.to_thread(audio_io.play_tone)
                print(f"[{sm.state.name}] 正在听...")

                vad.reset()
                audio = await asyncio.to_thread(
                    audio_io.stream_record_with_vad,
                    vad,
                    sample_rate=sr,
                    silence_ms=silence_ms,
                    max_seconds=max_sec,
                )

                duration = len(audio) / sr
                if duration < 0.3:
                    print("(录音太短，已忽略)\n")
                    sm.transition(State.IDLE)
                    continue

                # Transcribe
                sm.transition(State.PROCESSING)
                print(f"[{sm.state.name}] 识别中... ({duration:.1f}s)")

                try:
                    if local_stt:
                        text = await local_stt.transcribe(audio, sr=sr)
                    else:
                        wav_bytes = audio_io.numpy_to_wav_bytes(audio, sample_rate=sr)
                        text = await client.transcribe(wav_bytes, language=language)
                except Exception as e:
                    print(f"Error: STT 失败 ({e})\n")
                    sm.transition(State.IDLE)
                    continue

                if not text or not text.strip():
                    print("(未识别到内容)\n")
                    sm.transition(State.IDLE)
                    continue

                print(f"You: {text}")

                # Persist user message (non-fatal)
                try:
                    await session.add_user_message(text)
                except Exception as e:
                    print(f"Warning: 消息保存失败 ({e})")

                # --- AI response pipeline ---
                sm.transition(State.SPEAKING)
                print(f"[{sm.state.name}] AI 回复中...")
                cancel_event.clear()

                try:
                    result = await run_pipeline(
                        client=client,
                        messages=session.messages,
                        cancel=cancel_event,
                        tts_voice=tts_voice,
                        tts_speed=tts_speed,
                    )
                    if result.full_text:
                        print(f"AI: {result.full_text}")
                        try:
                            await session.add_assistant_message(result.full_text)
                        except Exception as e:
                            print(f"Warning: 回复保存失败 ({e})")
                        if result.meta:
                            m = result.meta
                            print(
                                f"  [{m.get('model', '')}] "
                                f"{m.get('total_tokens', 0)} tokens"
                            )
                    else:
                        print("(AI 无回复)")
                except ChatError as e:
                    print(f"Error: AI 回复错误 ({e})")
                except Exception as e:
                    print(f"Error: AI 回复失败 ({e})")

                sm.transition(State.IDLE)

            # ============================================================
            # SLEEPING — wait for space to wake up
            # ============================================================
            elif sm.state == State.SLEEPING:
                space_event.clear()
                print(f"[{sm.state.name}] Press Space to wake up...")
                await wait_for_space(space_event, timeout=None)
                print("(醒来了)\n")
                sm.transition(State.IDLE)

    except KeyboardInterrupt:
        print("\nBye!")
    finally:
        keyboard.unhook_all()
        audio_io.close_tts_player()
        await client.close()
        sm.reset()


def main() -> None:
    parser = argparse.ArgumentParser(description="Memoria Voice Service")
    parser.add_argument(
        "--test-audio",
        action="store_true",
        help="Record 5 seconds and play back (hardware sanity check)",
    )
    parser.add_argument(
        "--talk",
        action="store_true",
        help="Space-to-talk mode with STT and conversation persistence",
    )
    args = parser.parse_args()

    if args.test_audio:
        try:
            test_audio()
        except Exception as e:
            print(f"Audio test failed: {e}", file=sys.stderr)
            sys.exit(1)
        return

    if args.talk:
        try:
            asyncio.run(talk_loop())
        except Exception as e:
            print(f"Talk mode failed: {e}", file=sys.stderr)
            sys.exit(1)
        return

    print("Usage: python main.py --test-audio | --talk")
    print("  --test-audio   Record 5s and play back")
    print("  --talk         Space-to-talk with STT")
    sys.exit(0)


if __name__ == "__main__":
    main()
