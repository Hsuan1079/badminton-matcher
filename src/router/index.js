import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import AdminView from '../views/AdminView.vue'

const routes = [
  { path: '/', component: HomeView },
  { path: '/admin', component: AdminView },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
