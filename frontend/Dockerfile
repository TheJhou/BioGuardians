# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# Use relative API URL so nginx proxy handles routing.
# No need to know the VM IP at build time.
ENV VITE_API_URL=/api
RUN npm run build

# --- Runtime stage ---
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# nginx config that proxies /api to the backend container
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
\n\
  location /api {\n\
    proxy_pass http://backend:3001/api;\n\
    proxy_set_header Host $host;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
    proxy_set_header X-Forwarded-Proto $scheme;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
