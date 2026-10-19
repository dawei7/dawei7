FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

# The installer is too large for git. The public release asset is copied into the
# image so the website itself can hand it to a learner.
RUN apk add --no-cache curl \
 && curl -fsSL -o /usr/share/nginx/html/desktop/Professor-Euler-2.1.2.exe \
      https://github.com/dawei7/dawei7/releases/download/desktop-2.1.2/Professor-Euler-2.1.2.exe \
 && apk del curl

EXPOSE 8080
