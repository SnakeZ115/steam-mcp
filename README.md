# mcp-steam

Servidor **Model Context Protocol (MCP)** híbrido por `stdio` para controlar e inspeccionar tu biblioteca y actividad de **Steam**.

Combina dos modos complementarios:
1. **Inspección local y protocolos `steam://` (sin API Key)**: lee directamente los archivos locales `libraryfolders.vdf` y `appmanifest_*.acf`, consulta el Registro de Windows (`HKCU\Software\Valve\Steam\RunningAppID`), lanza juegos o vistas del cliente mediante URIs `steam://` validadas y busca en el catálogo público de la Steam Store.
2. **Steam Web API (opcional)**: si proporcionas `STEAM_API_KEY` y `STEAM_USER_ID`, desbloquea estadísticas de biblioteca completa, actividad en vivo de amigos y logros por juego. Si no están configuradas, las herramientas informan amablemente qué variables faltan sin romper el servidor.

---

## Herramientas disponibles (8)

| Herramienta | Modo / API Key | Descripción | Parámetros principales |
| :--- | :--- | :--- | :--- |
| `list_installed_games` | Local (sin API Key) | Lista todos los juegos de Steam instalados en todas las carpetas de biblioteca configuradas en `libraryfolders.vdf`. | `search` *(filtro por nombre, opcional)*, `onlyFullyInstalled` *(boolean, opcional)* |
| `get_running_game` | Local (sin API Key) | Detecta qué juego de Steam está en ejecución actualmente en Windows (`RunningAppID`) y lo cruza con los manifiestos locales. | *(Sin parámetros)* |
| `launch_game` | Local (sin API Key) | Inicia un juego instalado mediante `steam://rungameid/<appId>`, aceptando el ID numérico o el nombre del juego. | `appId` *(entero positivo)* o `gameName` *(nombre o subcadena)* |
| `open_steam_view` | Local (sin API Key) | Abre una vista específica del cliente local de Steam (`steam://`). | `view` (`"bigpicture"` \| `"downloads"` \| `"games"` \| `"friends"`) |
| `search_store_game` | Público (sin API Key) | Busca títulos en el catálogo público de Steam Store devolviendo App ID, precio, descuento, plataformas y Metascore. | `query` *(título o palabras clave, 1–200 caracteres)* |
| `get_owned_games_stats` | Web API *(opcional)* | Devuelve tus juegos con mayor tiempo de juego total y de las últimas 2 semanas. | `steamId` *(SteamID64 de 17 dígitos, opcional)*, `limit` (1–100, default `20`) |
| `get_friends_activity` | Web API *(opcional)* | Lista tus amigos conectados en Steam y el juego que están jugando actualmente. | `steamId` *(SteamID64 de 17 dígitos, opcional)* |
| `get_player_achievements` | Web API *(opcional)* | Obtiene los logros desbloqueados y el porcentaje de completado para un App ID específico. | `appId` *(entero positivo requerido)*, `steamId` *(opcional)* |

---

## Variables de entorno opcionales

Todas las variables son **opcionales**. Sin ninguna configurada, las 5 herramientas locales y de tienda pública funcionan al 100 %.

| Variable | Descripción |
| :--- | :--- |
| `STEAM_PATH` | Ruta manual a tu carpeta raíz de instalación de Steam. Si se omite, se detecta automáticamente vía Registro de Windows (`HKCU\Software\Valve\Steam`) o rutas estándar del sistema. |
| `STEAM_API_KEY` | Clave de la Steam Web API (puedes generarla en [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)). Habilita `get_owned_games_stats`, `get_friends_activity` y `get_player_achievements`. |
| `STEAM_USER_ID` | Tu **SteamID64 de 17 dígitos** utilizado por defecto en las consultas de la Steam Web API cuando no se pasa `steamId` explícitamente. |

> **Nota sobre privacidad en Steam:** para que la Steam Web API devuelva resultados en `get_owned_games_stats`, `get_friends_activity` y `get_player_achievements`, la visibilidad de *Detalles de juegos* y *Lista de amigos* en la configuración de privacidad de tu perfil de Steam debe estar en **Público**.

---

## Instalación y compilación

Requisitos: **Node.js 20+** y cliente de Steam instalado para las herramientas locales.

```bash
npm install
npm run build
```

Para verificar tipos y ejecutar las pruebas:

```bash
npm run typecheck
npm test
```

---

## Integración en `mcp_servers.json`

Ejemplo compatible con **Mitsuru-bot** (`config/mcp_servers.json`), **Claude Desktop** y **Cursor**:

### Configuración básica (sin API Key)

```json
{
  "mcpServers": {
    "steam": {
      "command": "node",
      "args": [
        "C:\\Users\\SENTINEL\\Documents\\mcp-steam\\dist\\index.js"
      ],
      "env": {},
      "disabled": false
    }
  }
}
```

### Configuración completa (con Steam Web API y ruta personalizada opcional)

```json
{
  "mcpServers": {
    "steam": {
      "command": "node",
      "args": [
        "C:\\Users\\SENTINEL\\Documents\\mcp-steam\\dist\\index.js"
      ],
      "env": {
        "STEAM_API_KEY": "TU_STEAM_WEB_API_KEY",
        "STEAM_USER_ID": "76561198000000000",
        "STEAM_PATH": "C:\\Program Files (x86)\\Steam"
      },
      "disabled": false
    }
  }
}
```
