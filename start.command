#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Démarrage de Club Privé — interface et serveur local"
echo "Ouvrez http://localhost:8787 une fois le serveur prêt."
npm start
