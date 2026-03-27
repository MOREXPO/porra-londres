# Porras multi-evento (sin dinero)

Web para crear y gestionar varias porras. Cada porra tiene:
- sus apuestas
- su resultado real
- su clasificación, gráfico y podio

Se mantiene la porra existente de Manu y puedes crear nuevas desde la interfaz.

## Ejecutar local
```bash
npm install
PORT=8787 ADMIN_EMAIL="iagomoreda1910@gmail.com" ADMIN_PASSWORD="Jisei0no0ku" npm start
```

## Endpoints principales
- `POST /api/admin/login` → login admin (devuelve token)
- `GET /api/admin/me` → comprobar sesión admin
- `POST /api/admin/logout` → cerrar sesión admin
- `GET /api/pools` → listar porras
- `POST /api/pools` (admin) → crear porra
- `PATCH /api/pools/:poolId` (admin) → editar nombre de porra
- `DELETE /api/pools/:poolId` (admin) → borrar porra (excepto la principal)
- `GET /api/pools/:poolId/leaderboard` → clasificación por porra
- `POST /api/pools/:poolId/bet` → guardar/editar apuesta
- `DELETE /api/pools/:poolId/bet/:name` → eliminar apuesta
- `POST /api/pools/:poolId/result` (admin) → publicar resultado real

## Dominio actual
- https://porra.iamoex.com

## Repo público
- https://github.com/MOREXPO/porra-londres
