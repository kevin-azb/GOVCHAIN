FROM node:18-alpine

WORKDIR /app

RUN npm install -g serve

COPY frontend ./frontend

EXPOSE 3000

CMD ["sh", "-c", "serve frontend -l ${PORT:-3000}"]
