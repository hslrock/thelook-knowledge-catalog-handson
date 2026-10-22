FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
COPY Knowledge_Catalog_Basic_Handson_Guide.md /usr/share/nginx/html/guide.md
COPY images/ /usr/share/nginx/html/images/
EXPOSE 8080
