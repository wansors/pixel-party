import { HttpClient } from '@angular/common/http'
import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { firstValueFrom } from 'rxjs'
import { environment } from '../../../environments/environment'

// Entry point: create a fresh room or enter an existing code, pick a name, then navigate to the room.
@Component({
  selector: 'app-join',
  imports: [FormsModule],
  template: `
    <main class="join">
      <h1>Pixel Party</h1>
      <input class="name" [(ngModel)]="name" placeholder="Your name" maxlength="16" />
      <button type="button" class="primary" (click)="createRoom()">Create room</button>
      <div class="enter">
        <input [(ngModel)]="code" placeholder="ROOM CODE" maxlength="6" />
        <button type="button" (click)="joinRoom()">Join</button>
      </div>
      @if (message()) {
        <p class="msg">{{ message() }}</p>
      }
    </main>
  `,
  styles: `
    .join { display: grid; gap: 1rem; place-content: center; height: 100vh; text-align: center;
      font-family: monospace; }
    h1 { color: #ffd166; letter-spacing: 0.15em; }
    input { text-align: center; padding: 0.6rem; font-family: monospace; background: #17212a;
      color: #e6edf3; border: 1px solid #33475a; border-radius: 4px; }
    .enter { display: flex; gap: 0.5rem; }
    .enter input { text-transform: uppercase; }
    button { padding: 0.6rem 1rem; font-family: monospace; background: #22303c; color: #e6edf3;
      border: 1px solid #33475a; border-radius: 4px; cursor: pointer; }
    button.primary { background: #06d6a0; color: #05231b; border-color: #06d6a0; }
    .msg { color: #ef476f; }
  `,
})
export class JoinComponent {
  private readonly http = inject(HttpClient)
  private readonly router = inject(Router)
  name = ''
  code = ''
  readonly message = signal('')

  async createRoom(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ code: string }>(`${environment.apiUrl}/api/rooms`, {}),
      )
      this.enter(res.code)
    } catch {
      this.message.set('Could not reach the server')
    }
  }

  async joinRoom(): Promise<void> {
    const code = this.code.trim().toUpperCase()
    if (!code) return
    try {
      const res = await firstValueFrom(
        this.http.get<{ exists: boolean }>(`${environment.apiUrl}/api/rooms/${code}`),
      )
      if (!res.exists) {
        this.message.set(`Room ${code} not found`)
        return
      }
      this.enter(code)
    } catch {
      this.message.set('Could not reach the server')
    }
  }

  private enter(code: string): void {
    const name = this.name.trim()
    this.router.navigate(['/room', code], { queryParams: name ? { name } : {} })
  }
}
