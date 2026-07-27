<script setup lang="ts"></script>

<template>
  <nav class="nav">
    <span class="brand">news-feed</span>
    <RouterLink to="/">Search</RouterLink>
    <RouterLink to="/feed">Feed</RouterLink>
  </nav>

  <main class="page">
    <RouterView />
  </main>
</template>
