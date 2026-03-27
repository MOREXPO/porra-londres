# Porra de Manu (apuestas en euros)

Web para que varios usuarios hagan una porra sobre cuántas veces roban a Manu y cuánto apuestan en euros.

## Ejecutar local
```bash
npm install
PORT=8787 ADMIN_KEY="tu-clave-segura" npm start
```

## Publicar resultado real (admin)
```bash
curl -X POST http://localhost:8787/api/result \
  -H "Content-Type: application/json" \
  -H "x-admin-key: tu-clave-segura" \
  -d '{"realCount":5}'
```

## Dominio actual
- https://porra.iamoex.com

## Repo público
- https://github.com/MOREXPO/porra-londres
