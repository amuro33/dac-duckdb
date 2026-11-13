FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY src/Portal.Web/package*.json src/Portal.Web/.npmrc ./
RUN npm ci
COPY src/Portal.Web/ ./
RUN npm run build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /source
COPY src/Portal.Api/ src/Portal.Api/
RUN dotnet publish src/Portal.Api -c Release -o /app
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app .
COPY --from=web /web/dist ./wwwroot
ENV ASPNETCORE_HTTP_PORTS=8080
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet","Portal.Api.dll"]
