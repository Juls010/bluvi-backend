# 🫧 Bluvi - Backend API

Esta es la API REST que sustenta la plataforma **Bluvi**. Está diseñada bajo una arquitectura sólida para gestionar el registro de usuarios neurodivergentes, la autenticación segura y la persistencia de datos en un entorno controlado.

## Tecnologías y Herramientas

* **Node.js & Express**: Framework principal para la lógica de la API.
* **PostgreSQL**: Base de datos relacional para una gestión de datos robusta.
* **Docker**: Contenedorización de la base de datos para asegurar la portabilidad.
* **JWT (JSON Web Tokens)**: Sistema de autenticación basado en tokens.

## Instalación y Configuración

1.  **Clona el repositorio:**
    ```bash
    git clone https://github.com/Juls010/bluvi-backend.git
    cd bluvi-backend
    ```

2.  **Instala las dependencias:**
    ```bash
    npm install
    ```

3.  **Configuración de Variables de Entorno:**
    Copia `.env.example` a `.env` y completa los valores reales:
    ```bash
    cp .env.example .env
    ```

    Variables clave:
    - `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET`: secretos largos y diferentes.
    - `ALLOWED_ORIGINS`: lista de orígenes frontend separados por coma.
    - `TRUST_PROXY=true`: si despliegas detrás de Nginx/Render/Railway/Cloudflare.
    - `CLOUDFLARE_ENABLED=true`: activa fallback de proxy confiable para edge de Cloudflare.
        - `REDIS_URL=redis://...`: habilita caché distribuida con Redis (cliente TCP nativo).
        - `REDIS_REST_URL` y `REDIS_REST_TOKEN`: alternativa REST (por ejemplo Upstash).
            También se aceptan `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.
    - `REDIS_DEFAULT_TTL_SECONDS=60`: TTL por defecto para entradas de caché.
    - `CACHE_REGISTER_METADATA_TTL_SECONDS=3600`: TTL para metadata de registro.
    - `CACHE_EXPLORE_TTL_SECONDS=30`: TTL para listados de descubrimiento.

## Gestión de Base de Datos (Docker)

El entorno local de desarrollo puede levantarse con Docker usando tres servicios:

* **Node.js**: ejecuta la API en modo desarrollo.
* **PostgreSQL**: base de datos local para pruebas.
* **Redis**: apoyo para caché, rate limit o colas si se activa en el backend.

* **Levantar todo el stack:** `docker-compose up -d`
* **Ver logs:** `docker-compose logs -f app`
* **Detener todo:** `docker-compose down`

Si más adelante migras la base de datos a Supabase, solo tendrás que cambiar `DATABASE_URL` por la cadena de conexión de Supabase y dejar de usar el servicio `db` local.

### Migración a Supabase

1. Crea el proyecto en Supabase y copia la conexión directa de PostgreSQL.
2. En producción, pon `DATABASE_SSL=true`.
3. Exporta tu base local con `pg_dump`.
4. Restaura el dump en Supabase con `psql` o con el SQL editor de Supabase.
5. Cambia `DATABASE_URL` en tu entorno de despliegue.
6. Mantén Docker solo para desarrollo local si te sigue siendo útil.

## Seguridad mínima para publicar (beta)

- Cabeceras seguras con `helmet` activadas.
- CORS restringido por `ALLOWED_ORIGINS`.
- Rate limiting global y estricto en rutas de autenticación.
- Validación de payloads con `zod` antes de tocar base de datos.
- Cookies de refresh token `httpOnly` y `secure` en producción.

## Redis (caché de alta disponibilidad)

- El backend usa Redis de forma opcional: si `REDIS_URL` no está configurada, sigue funcionando sin caché.
- Endpoints cacheados:
    - `GET /api/auth/metadata`
    - `GET /api/users/explore`
- Invalida caché de discovery del usuario cuando actualiza perfil, privacidad o marca perfiles vistos.

## Cloudflare (SSL + capa de seguridad)

- Configura tu dominio en Cloudflare con SSL/TLS en modo `Full (strict)`.
- Activa `Always Use HTTPS` y `Automatic HTTPS Rewrites`.
- Recomendado: habilitar WAF Managed Rules y Rate Limiting en rutas sensibles (`/api/auth/*`).
- El backend ya toma IP real desde `CF-Connecting-IP` y `X-Forwarded-For` para rate limit fiable.
- Mantén `TRUST_PROXY=true` o `CLOUDFLARE_ENABLED=true` cuando estés detrás de Cloudflare.



## Próximos Pasos en el Desarrollo

* [ ] **Definición del Schema**: Creación de las tablas de Usuario y Perfil con Prisma/Sequelize.
* [ ] **Sistema de Rutas**: Implementación de los endpoints para el registro de 12 pasos.
* [ ] **Middlewares de Seguridad**: Capa de validación para proteger los datos de salud y neurodivergencia.
* [ ] **Integración con EmailJS**: Verificación de cuentas.

---

## Estructura del Proyecto (Actualmente)

* `src/controllers`: Lógica de negocio (en desarrollo).
* `src/routes`: Definición de accesos API (planificado).
* `src/models`: Modelado de datos PostgreSQL.

Actualmente en construcción - 
Julia N.G 💕
