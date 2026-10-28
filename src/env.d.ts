/// <reference types="astro/client" />

interface Locals {
  errorMessage?: string;
}

declare namespace App {
  interface Locals {
    errorMessage?: string;
  }
}

