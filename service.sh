#!/bin/sh
mainpath=$(dirname $0)
ip=${1:-127.0.0.1};
port=${2:-8000};
/usr/bin/env nodejs $mainpath/main.js $ip $port
