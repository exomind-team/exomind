/// <reference types="astro/client" />

type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

interface Env {
  RELEASES: R2Bucket;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
