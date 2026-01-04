FROM amazon/aws-lambda-nodejs:22

# Copy package files
COPY package.json ${LAMBDA_TASK_ROOT}
COPY package-lock.json ${LAMBDA_TASK_ROOT}

# Install dependencies using npm
RUN npm ci

# Copy source code
COPY src/ ${LAMBDA_TASK_ROOT}/src/
COPY tsconfig.json ${LAMBDA_TASK_ROOT}

# Build TypeScript to JavaScript
RUN npm run build

# Set the handler
CMD ["dist/index.handler"]
