import { createRouter, createWebHistory } from 'vue-router';
import FeedPage from './pages/FeedPage.vue';
import SearchPage from './pages/SearchPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'search', component: SearchPage },
    { path: '/feed', name: 'feed', component: FeedPage },
  ],
});
