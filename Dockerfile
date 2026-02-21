# ---- 基础镜像 ----
# alpine 是超轻量 Linux（~5MB），node:20-alpine 整个才 ~130MB
FROM node:20-alpine

# ---- 工作目录 ----
# 容器内的"项目文件夹"，后续命令都在这里执行
WORKDIR /app

# ---- 安装依赖 ----
# 先只复制 package*.json，利用 Docker 缓存机制：
# 只要 package.json 没变，下次构建就跳过 npm install（很快）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- 复制项目代码 ----
# .dockerignore 里排除的文件不会被复制进来
COPY . .

# ---- 创建数据目录 ----
# 确保 data/ 和 prompts/ 目录存在（后面会通过 volume 映射到宿主机）
RUN mkdir -p data/conversations data/images prompts

# ---- 非 root 用户 ----
# 安全最佳实践：不用 root 跑应用，万一有漏洞也降低影响
# node:20-alpine 自带一个 node 用户（uid=1000）
RUN chown -R node:node /app
USER node

# ---- 暴露端口 ----
# 声明容器监听 3000 端口（实际映射由 docker-compose 控制）
EXPOSE 3000

# ---- 健康检查 ----
# Docker 每 30 秒戳一下这个地址，5 秒没响应就算不健康
# 连续 3 次不健康，Docker Desktop 会标红提醒你
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/config || exit 1

# ---- 启动命令 ----
CMD ["node", "server.js"]
