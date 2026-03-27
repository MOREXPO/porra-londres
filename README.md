# Porra Londres (incidencias semanales)

Web sencilla para que varios usuarios hagan una porra semanal sobre el número de robos/incidencias reportadas en Londres.

## Stack
- Node.js + Express
- SQLite (better-sqlite3)
- Frontend HTML/CSS/JS

## Ejecutar local
```bash
npm install
ADMIN_KEY="tu-clave-segura" npm start
```
Abre: http://localhost:8787

## Publicar resultado semanal (admin)
```bash
curl -X POST http://localhost:8787/api/result \
  -H "Content-Type: application/json" \
  -H "x-admin-key: tu-clave-segura" \
  -d '{"weekLabel":"2026-W13","realCount":312}'
```

## Crear repo público en GitHub
```bash
git init
git add .
git commit -m "feat: porra londres"
gh repo create porra-londres --public --source=. --remote=origin --push
```

## Exponer con Cloudflare Tunnel (rápido)
```bash
cloudflared tunnel --url http://localhost:8787
```
Te devolverá una URL pública tipo `https://xxxxx.trycloudflare.com`.
