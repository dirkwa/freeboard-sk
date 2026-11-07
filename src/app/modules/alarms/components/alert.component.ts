// Alert Component

import {
  Component,
  Output,
  EventEmitter,
  input,
  effect,
  signal,
  inject,
  ChangeDetectionStrategy,
  NgZone
} from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TimerButtonComponent } from './timer-button.component';

import { AppFacade } from 'src/app/app.facade';
import { NotificationManager } from '../notification-manager';
import { AppIconDef } from '../../icons';
import { ALARM_STATE, CpaPositions, SKPosition } from 'src/app/types';
import { CourseService } from '../../course';

/** Extra data carried by the notification that raised the alert. */
export interface AlertProperties {
  position?: SKPosition;
  /** Vessel context of the other party (closest approach alerts). */
  vesselId?: string;
  /** Where own vessel and the other party will be at closest approach. */
  cpaPositions?: CpaPositions;
}

export interface AlertData {
  id: string;
  path: string;
  priority: ALARM_STATE;
  message: string;
  sound: boolean;
  visual: boolean;
  properties: AlertProperties;
  icon: AppIconDef;
  type?: string;
  acknowledged: boolean;
  silenced: boolean;
  canAcknowledge?: boolean;
  canSilence?: boolean;
  canCancel?: boolean;
  createdAt: number;
}

const SoundFiles: Partial<Record<ALARM_STATE, string>> = {
  emergency: './assets/sound/woop.mp3',
  alarm: './assets/sound/woop.mp3',
  alert: './assets/sound/ding.mp3',
  warn: './assets/sound/ding.mp3'
};

@Component({
  selector: 'fb-alert',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressBarModule,
    TimerButtonComponent
  ],
  template: `
    @if (app.uiCtrl().alertList || hidden()) {
      <span></span>
    } @else {
      @if (alert().visual && !alert().acknowledged) {
        <div class="alert-row" [class]="'alert-' + alert().priority">
          <mat-icon
            class="alert-icon {{ alert().icon.class }}"
            [svgIcon]="alert().icon.svgIcon ?? ''"
            >{{ alert().icon.name }}</mat-icon
          >
          <div class="alert-message" [title]="alert().message">
            {{ alert().message }}
          </div>
          <div class="alert-actions">
            @if (app.data.activeRoute) {
              @let isLastPoint =
                course.courseData().pointIndex ===
                course.courseData().pointTotal - 1;
              @if (
                app.config.course.autoNextPointOnArrival &&
                app.config.course.autoNextPointTrigger === alert().type
              ) {
                @if (isLastPoint) {
                  <timer-button
                    [disabled]="nextPointClicked"
                    [icon]="'clear_all'"
                    [label]="'End Route in'"
                    [cancelledLabel]="'End Route'"
                    [period]="app.config.course.autoNextPointDelay"
                    (nextPoint)="endRoute()"
                  >
                  </timer-button>
                } @else {
                  <timer-button
                    [disabled]="nextPointClicked"
                    [icon]="'skip_next'"
                    [label]="'Next point in'"
                    [cancelledLabel]="'NEXT POINT'"
                    [period]="app.config.course.autoNextPointDelay"
                    (nextPoint)="gotoNextPoint()"
                  >
                  </timer-button>
                }
              } @else if (showStaticNextPoint) {
                @if (isLastPoint) {
                  <button
                    mat-icon-button
                    matTooltip="End route"
                    [disabled]="nextPointClicked"
                    (click)="endRoute()"
                  >
                    <mat-icon>clear_all</mat-icon>
                  </button>
                } @else {
                  <button
                    mat-icon-button
                    matTooltip="Next point"
                    [disabled]="nextPointClicked"
                    (click)="gotoNextPoint()"
                  >
                    <mat-icon>skip_next</mat-icon>
                  </button>
                }
              }
            }
            @if (alert().sound && alert().canSilence) {
              <button
                mat-icon-button
                [matTooltip]="alert().silenced ? 'Muted' : 'Mute'"
                [disabled]="alert().silenced"
                (click)="muteAlarm()"
              >
                <mat-icon
                  class="ob"
                  [svgIcon]="
                    alert().silenced
                      ? 'sound-off-fill'
                      : 'sound-unavailable-fill'
                  "
                ></mat-icon>
              </button>
            }
            @if (alert().canAcknowledge) {
              <button
                mat-icon-button
                matTooltip="Acknowledge"
                (click)="ackAlarm()"
              >
                <mat-icon>check</mat-icon>
              </button>
            } @else {
              <button mat-icon-button matTooltip="Dismiss" (click)="hide()">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          @if (!alert().canAcknowledge) {
            <mat-progress-bar
              class="alert-timer"
              mode="determinate"
              [value]="progressValue()"
            ></mat-progress-bar>
          }
        </div>
      }
    }
  `,
  styles: [
    `
      .alert-row {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
        margin-bottom: 4px;
        padding: 0 4px 0 8px;
        border-left: 5px solid var(--alert-color, gray);
        border-radius: 6px;
        overflow: hidden;
        background-color: var(--mat-app-background-color, white);
      }
      /* Translucent like the Plotter Extensions widgets, so the chart shows through. */
      @supports (background-color: color-mix(in srgb, white 78%, transparent)) {
        .alert-row {
          background-color: color-mix(
            in srgb,
            var(--mat-app-background-color, white) 78%,
            transparent
          );
        }
      }
      .alert-emergency,
      .alert-alarm {
        --alert-color: #f44336;
      }
      .alert-warn,
      .alert-alert {
        --alert-color: #ff9800;
      }
      .alert-icon {
        flex: none;
      }
      .alert-message {
        flex: 1 1 auto;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .alert-actions {
        flex: none;
        display: flex;
        align-items: center;
      }
      .alert-timer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 3px;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlertComponent {
  alert = input.required<AlertData>();
  acknowledged = input<boolean>(false);
  silenced = input<boolean>(false);
  audioStatus = input<string>(); // changed audio context state
  doNotPlaySound = input<boolean>(false); // config setting

  hidden = signal<boolean>(false); // alert card is hidden
  progressValue = signal<number>(100);

  @Output() nextPoint: EventEmitter<void> = new EventEmitter();
  @Output() routeEnd: EventEmitter<void> = new EventEmitter();

  protected showStaticNextPoint = false;
  protected showAutoNextPoint = false;
  protected nextPointClicked = false;
  private audio?: HTMLAudioElement;
  private source?: MediaElementAudioSourceNode;
  private soundFile = SoundFiles.warn;
  private timerRef: ReturnType<typeof setInterval> | null = null;

  protected app = inject(AppFacade);
  private notiMgr = inject(NotificationManager);
  protected course = inject(CourseService);
  private ngZone = inject(NgZone);

  constructor() {
    effect(() => {
      // Read (not just stored) so the effect re-runs when these inputs
      // change, even though only al.type/priority below is consulted.
      this.acknowledged();
      this.silenced();
      const al = this.alert();
      this.showStaticNextPoint =
        !!al.type &&
        ['perpendicularPassed', 'arrivalCircleEntered'].includes(al.type);
      this.showAutoNextPoint =
        this.showStaticNextPoint &&
        this.app.config.course.autoNextPointTrigger === al.type;
      // Read here, unconditionally, so the effect re-runs when the input
      // changes. processAudio() also reads it, but only behind guards that
      // can short-circuit, so this is the one registration that always runs.
      this.doNotPlaySound();
      this.processAudio();
      if (
        !this.timerRef &&
        !['emergency', 'alarm'].includes(this.alert().priority) &&
        !this.showAutoNextPoint
      ) {
        // hide after set time secs. Run the 100ms ticker OUTSIDE the Angular
        // zone so it doesn't trigger an app-wide change detection 10x/sec; the
        // progressValue/hidden signal writes mark this OnPush component for
        // check on their own.
        this.ngZone.runOutsideAngular(() => {
          this.timerRef = setInterval(() => {
            if (this.progressValue() > 0) {
              this.progressValue.update((value) => value - 4);
            } else {
              this.hidden.set(true);
              if (this.timerRef) {
                clearInterval(this.timerRef);
              }
            }
          }, 100);
        });
      }
    });
  }

  ngOnDestroy() {
    // The progress-bar timer runs outside the Angular zone, so clear it here in
    // case the component is destroyed before the bar self-clears.
    if (this.timerRef) {
      clearInterval(this.timerRef);
      this.timerRef = null;
    }
    this.audio?.pause();
    this.audio = undefined;
    this.source = undefined;
  }

  protected hide() {
    this.hidden.set(true);
  }

  protected ackAlarm() {
    this.notiMgr.acknowledge(this.alert().path);
  }

  protected muteAlarm() {
    this.notiMgr.silence(this.alert().path);
  }

  private processAudio() {
    this.soundFile = SoundFiles[this.alert().priority];
    if (this.app.audio.context) {
      if (!this.audio) {
        this.audio = new Audio();
      }
      if (!this.source) {
        this.source = this.app.audio.context.createMediaElementSource(
          this.audio
        );
        this.source.connect(this.app.audio.context.destination);
      }
      if (this.audioStatus() === 'running') {
        if (this.alert().sound) {
          if (
            this.doNotPlaySound() ||
            this.alert().silenced ||
            this.alert().acknowledged
          ) {
            this.audio.pause();
          } else if (this.soundFile) {
            this.audio.loop = ['emergency', 'alarm'].includes(
              this.alert().priority
            );
            this.audio.src = this.soundFile;
            this.audio
              .play()
              .then((): void => undefined)
              .catch((): void => undefined);
          } else {
            // no sound for this alarm state
            this.audio.pause();
          }
        } else {
          this.audio.pause();
        }
      }
    }
  }

  // arrival alarm - goto next point handler
  gotoNextPoint() {
    this.nextPointClicked = true;
    this.nextPoint.emit();
    this.hide();
  }

  // end route
  endRoute() {
    this.nextPointClicked = true;
    this.routeEnd.emit();
    this.hide();
  }
}
