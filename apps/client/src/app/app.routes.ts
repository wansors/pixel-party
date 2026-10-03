import type { Routes } from '@angular/router'
import { JoinComponent } from './features/join/join.component'

// The room (and with it Phaser and every mini-game scene) is a lazy chunk: the join screen loads fast
// and the initial bundle stays small however many games the catalog grows.
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: JoinComponent },
  {
    path: 'room/:code',
    loadComponent: () => import('./features/room/room.component').then((m) => m.RoomComponent),
  },
  { path: '**', redirectTo: '' },
]
