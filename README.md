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
    Crea un archivo `.env` en la raíz del proyecto (este archivo está ignorado por Git por seguridad) y añade lo siguiente:
    ```env
    PORT=3000
    DATABASE_URL="postgresql://bluvi_user:bluvi_password@localhost:5432/bluvi_database"
    JWT_SECRET="Bluvi-Safe-Connections-2026-Auth-Secret-Key!"
    ```

## Gestión de Base de Datos (Docker)

La base de datos PostgreSQL se gestiona mediante Docker para evitar instalaciones locales complejas:

* **Levantar base de datos:** `docker-compose up -d`
* **Detener base de datos:** `docker-compose stop`



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
