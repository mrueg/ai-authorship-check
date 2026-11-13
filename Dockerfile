# AI Authorship Check action image: Node runtime + ONNX export of the classifier
# (int8 if quantization keeps scores close to PyTorch, otherwise fp32; see model/export.py).
#
#   docker build -t ai-authorship-check .                          # real model (needs ~8 GB RAM to export)
#   docker build -t ai-authorship-check --build-arg MODEL_TINY=true .   # random 3-layer model, for smoke tests

ARG MODEL_REPO=ShantanuT01/vanguard-ai-text-detector
ARG MODEL_REVISION=823061be63b90f2b42f64ac1e1f82772e872533b
ARG MODEL_TINY=false

# --- 1. Export the model to ONNX and verify it against PyTorch --------------
FROM python:3.12-slim-bookworm AS export
WORKDIR /work
COPY model/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY model/export.py .
ARG MODEL_REPO
ARG MODEL_REVISION
ARG MODEL_TINY
RUN python export.py --repo "$MODEL_REPO" --revision "$MODEL_REVISION" --out /model \
      $( [ "$MODEL_TINY" = "true" ] && echo --tiny )

# --- 2. Build the action ----------------------------------------------------
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# onnxruntime-node's install script only fetches optional CUDA binaries.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --ignore-scripts \
 # transformers.js bundles its own copy of onnxruntime-web; the package is unused in Node.
 && rm -rf node_modules/onnxruntime-web \
 # Keep only the CPU runtime for this platform (drops ~500 MB of CUDA/TensorRT/other OS binaries).
 && arch="$(node -p process.arch)" \
 && find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
 && find node_modules/onnxruntime-node/bin/napi-v6/linux -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} + \
 && rm -f node_modules/onnxruntime-node/bin/napi-v6/linux/*/libonnxruntime_providers_*

# --- 3. Runtime ---------------------------------------------------------------
FROM node:26-bookworm-slim
ENV NODE_ENV=production \
    AI_AUTHORSHIP_CHECK_MODEL_PATH=/model
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=export /model /model
ENTRYPOINT ["node", "/app/dist/main.js"]
