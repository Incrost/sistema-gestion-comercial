# sistema-gestion-comercial
Segundo parcial de Programación IV - Sistema de gestión comercial

## Usuarios de prueba (solo desarrollo)

`pnpm run db:seed` crea, si no existen, dos usuarios académicos. Es idempotente:
si ya existen no los duplica ni les cambia la contraseña. Son credenciales
ficticias de demostración (dominio reservado `.test`), no personales.

| Rol           | Email                    | Contraseña             |
| ------------- | ------------------------ | ---------------------- |
| Administrador | `admin@comercio.test`    | `Admin-Prueba-2026`    |
| Vendedor      | `vendedor@comercio.test` | `Vendedor-Prueba-2026` |

Definidos en `src/db/semillas/usuarios.ts`. En la base solo se guarda el hash bcrypt.
