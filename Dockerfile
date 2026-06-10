# Stage 1: Build dependencies
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci

# Stage 2: Runtime image
FROM node:20-alpine
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package*.json ./
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
