import type { Routes } from '@angular/router'
import { JoinComponent } from './features/join/join.component'
import { RoomComponent } from './features/room/room.component'

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: JoinComponent },
  { path: 'room/:code', component: RoomComponent },
  { path: '**', redirectTo: '' },
]
