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

<script setup lang="ts"></script>

<style scoped>
.nav {
  display: flex;
  gap: 20px;
  align-items: baseline;
  border-bottom: 1px solid var(--border);
  padding: 16px;
}

.nav a {
  text-decoration: none;
  color: var(--text-muted);
}

/* vue-router sets this class on the link matching the current route. */
.nav a.router-link-active {
  color: var(--text);
  font-weight: 600;
}

.brand {
  font-weight: 700;
  margin-right: auto;
}

.page {
  max-width: var(--page);
  margin: 0 auto;
  padding: 24px 16px 64px;
}
</style>
