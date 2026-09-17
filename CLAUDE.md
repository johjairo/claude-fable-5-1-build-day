# CLAUDE.md

Guía para Claude Code al trabajar en este repositorio.

## Contexto

Repositorio del workshop **Build Day** (2026-09-16). Trabajan en pareja John Sanchez y Sergio. Objetivo: entregar un prototipo funcional al final del día.

## Idioma

- `README.md`, `CLAUDE.md` y cualquier documentación para humanos: **español**.
- Nombres de features, recursos, identificadores, código, comentarios en código y mensajes de commit: **inglés**.
- Los prompts llegan en inglés; no traducir nombres de features ni recursos al responder o al crear archivos.

## Principios de trabajo

- Es un prototipo con tiempo limitado: preferir soluciones simples y ejecutables sobre arquitectura elaborada.
- Mantener el `README.md` actualizado para que cualquiera de los dos pueda retomar el trabajo rápido.
- No agregar dependencias ni abstracciones que no se necesiten hoy.

## Git

- Rama principal: `main`.
- Remoto por HTTPS (el puerto 22 de SSH está bloqueado en la red del workshop). Si el push pide credenciales, ejecutar una vez `gh auth setup-git`.
- Commits pequeños y frecuentes, en inglés, formato Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Stack

Por definir. Actualizar esta sección en cuanto se elija.
