/**
 * Capa de caché con Redis (cuando REDIS_URL está configurado) o Map en memoria (fallback).
 * Uso: await cache.get(key) / cache.set(key, value, ttlSeconds) / cache.del(key) / cache.delByPrefix(prefix)
 *
 * Para habilitar Redis en Railway: agregar variable de entorno REDIS_URL.
 */
const logger = require('./logger');

var _redis  = null;
var _memStore = new Map(); // fallback en memoria

function getRedis() {
  if (_redis) return _redis;
  var url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    var Redis = require('ioredis');
    _redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableReadyCheck: false });
    _redis.on('error', function(e) { logger.warn({ err: e }, '[cache] Redis error — usando fallback en memoria'); _redis = null; });
    logger.info('[cache] Redis conectado');
    return _redis;
  } catch (e) {
    logger.warn({ err: e }, '[cache] No se pudo conectar a Redis — usando fallback en memoria');
    return null;
  }
}

async function get(key) {
  var r = getRedis();
  try {
    if (r) {
      var val = await r.get(key);
      return val ? JSON.parse(val) : null;
    }
    var entry = _memStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) { _memStore.delete(key); return null; }
    return entry.val;
  } catch (e) {
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  ttlSeconds = ttlSeconds || 60;
  var r = getRedis();
  try {
    if (r) {
      await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } else {
      _memStore.set(key, { val: value, exp: Date.now() + ttlSeconds * 1000 });
    }
  } catch (e) {
    // silently ignore cache write errors
  }
}

async function del(key) {
  var r = getRedis();
  try {
    if (r) await r.del(key);
    else _memStore.delete(key);
  } catch (e) {}
}

async function delByPrefix(prefix) {
  var r = getRedis();
  try {
    if (r) {
      var keys = await r.keys(prefix + '*');
      if (keys.length) await r.del(keys);
    } else {
      for (var k of _memStore.keys()) {
        if (k.startsWith(prefix)) _memStore.delete(k);
      }
    }
  } catch (e) {}
}

module.exports = { get, set, del, delByPrefix };
