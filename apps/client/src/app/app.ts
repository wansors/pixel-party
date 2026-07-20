import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'

// Thin shell: hosts the router outlet. The join screen, lobby, round canvas and scoreboards live in
// routed feature components; the Phaser canvas is owned by the round feature, decoupled from Angular.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
