/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import '../../elevation/elevation.js';

import {html, LitElement, PropertyValues} from 'lit';
import {property, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';

import {redispatchEvent} from '../../internal/controller/events.js';
import {createThrottle, msFromTimeCSSValue} from '../../internal/motion/animation.js';

/**
 * Default close action.
 */
export const CLOSE_ACTION = 'close';

/**
 * A dialog component.
 *
 * @fires opening Dispatched when the dialog is opening before any animations.
 * @fires opened Dispatched when the dialog has opened after any animations.
 * @fires closing Dispatched when the dialog is closing before any animations.
 * @fires closed Dispatched when the dialog has closed after any animations.
 * @fires cancel The native HTMLDialogElement cancel event.
 */
export class Dialog extends LitElement {
  /**
   * Opens the dialog when set to `true` and closes it when set to `false`.
   */
  @property({type: Boolean}) open = false;

  /**
   * Setting fullscreen displays the dialog fullscreen on small screens.
   * This can be customized via the `fullscreenBreakpoint` property.
   * When showing fullscreen, the header will take up less vertical space, and
   * the dialog will have a `showing-fullscreen`attribute, allowing content to
   * be styled in this state.
   */
  @property({type: Boolean}) fullscreen = false;

  /**
   * A media query string specifying the breakpoint at which the dialog
   * should be shown fullscreen. Note, this only applies when the `fullscreen`
   * property is set.
   *
   * By default, the dialog is shown fullscreen on screens less than 600px wide
   * or 400px tall.
   */
  @property({attribute: 'fullscreen-breakpoint'})
  fullscreenBreakpoint = '(max-width: 600px), (max-height: 400px)';

  /**
   * Hides the dialog footer, making any content slotted into the footer
   * inaccessible.
   */
  @property({type: Boolean, attribute: 'footer-hidden'}) footerHidden = false;

  /**
   * When the dialog is closed it disptaches `closing` and `closed` events.
   * These events have an action property which has a default value of
   * the value of this property. Specific actions have explicit values but when
   * a value is not specified, the default is used. For example, clicking the
   * scrim, pressing escape, or clicking a button with an action attribute set
   * produce an explicit action.
   *
   * Defaults to `close`.
   */
  @property({attribute: 'default-action'}) defaultAction = CLOSE_ACTION;

  /**
   * The name of an attribute which can be placed on any element slotted into
   * the dialog. If an element has an action attribute set, clicking it will
   * close the dialog and the `closing` and `closed` events dispatched will
   * have their action property set the value of this attribute on the
   * clicked element.The default value is `dialog-action`. For example,
   *
   *   <md-dialog>
   *    Content
   *     <md-filled-button slot="footer" dialog-action="buy">
   *       Buy
   *     </md-filled-button>
   *   </md-dialog>
   */
  @property({attribute: 'action-attribute'}) actionAttribute = 'dialog-action';

  /**
   * Clicking on the scrim surrounding the dialog closes the dialog.
   * The `closing` and `closed` events this produces have an `action` property
   * which is the value of this property and defaults to `close`.
   */
  @property({attribute: 'scrim-click-action'}) scrimClickAction = CLOSE_ACTION;

  /**
   * Pressing the `escape` key while the dialog is open closes the dialog.
   * The `closing` and `closed` events this produces have an `action` property
   * which is the value of this property and defaults to `close`.
   */
  @property({attribute: 'escape-key-action'}) escapeKeyAction = CLOSE_ACTION;

  private readonly throttle = createThrottle();

  @query('.dialog', true)
  private readonly dialogElement!: HTMLDialogElement|null;

  // slots tracked to find focusable elements.
  @query('slot[name=footer]', true)
  private readonly footerSlot!: HTMLSlotElement;
  @query('slot:not([name])', true)
  private readonly contentSlot!: HTMLSlotElement;
  // for scrolling related styling
  @query(`.content`, true)
  private readonly contentElement!: HTMLDivElement|null;
  @query(`.container`, true)
  private readonly containerElement!: HTMLDivElement|null;

  /**
   * Private properties that reflect for styling manually in `updated`.
   */
  @state() private showingFullscreen = false;
  @state() private showingOpen = false;
  @state() private opening = false;
  @state() private closing = false;

  private currentAction: string|undefined;

  /**
   * Opens and shows the dialog. This is equivalent to setting the `open`
   * property to true.
   */
  show() {
    this.open = true;
  }

  /**
   * Closes the dialog. This is equivalent to setting the `open`
   * property to false.
   */
  close(action = '') {
    this.currentAction = action;
    this.open = false;
  }

  private getContentScrollInfo() {
    if (!this.hasUpdated || !this.contentElement) {
      return {isScrollable: false, isAtScrollTop: true, isAtScrollBottom: true};
    }
    const {scrollTop, scrollHeight, offsetHeight, clientHeight} =
        this.contentElement;
    return {
      isScrollable: scrollHeight > offsetHeight,
      isAtScrollTop: scrollTop === 0,
      isAtScrollBottom:
          Math.abs(Math.round(scrollHeight - scrollTop) - clientHeight) <= 2
    };
  }

  protected override render() {
    const {isScrollable, isAtScrollTop, isAtScrollBottom} =
        this.getContentScrollInfo();
    return html`
    <dialog
      @close=${this.handleDialogDismiss}
      @cancel=${this.handleDialogDismiss}
      @click=${this.handleDialogClick}
      class="dialog ${classMap({
      'scrollable': isScrollable,
      'scroll-divider-header': !isAtScrollTop,
      'scroll-divider-footer': !isAtScrollBottom,
      'footerHidden': this.footerHidden
    })}"
      aria-labelledby="header"
      aria-describedby="content"
    >
      <slot name="dialog_content_slot></slot>
      <div class="container">
        <md-elevation></md-elevation>
        <header class="header">
          <slot name="header">
            <slot name="headline-prefix"></slot>
            <slot name="headline"></slot>
            <slot name="headline-suffix"></slot>
          </slot>
        </header>
        <section class="content" @scroll=${this.handleContentScroll}>
          <slot></slot>
        </section>
        <footer class="footer">
          <slot name="footer"></slot>
        </footer>
      </div>
    </dialog>`;
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('open')) {
      this.opening = this.open;
      // only closing if was opened previously...
      this.closing = !this.open && changed.get('open');
    }
    if (changed.has('fullscreen') || changed.has('fullscreenBreakpoint')) {
      this.updateFullscreen();
    }
  }

  protected override firstUpdated() {
    // Update when content size changes to show/hide scroll dividers.
    new ResizeObserver(() => {
      if (this.showingOpen) {
        this.requestUpdate();
      }
    }).observe(this.contentElement!);
  }

  protected override updated(changed: PropertyValues) {
    // Reflect internal state to facilitate styling.
    this.reflectStateProp(changed, 'opening', this.opening);
    this.reflectStateProp(changed, 'closing', this.closing);
    this.reflectStateProp(
        changed, 'showingFullscreen', this.showingFullscreen,
        'showing-fullscreen');
    this.reflectStateProp(
        changed, 'showingOpen', this.showingOpen, 'showing-open');
    if (!changed.has('open')) {
      return;
    }
    if (this.open) {
      this.contentElement!.scrollTop = 0;
      // Note, native focus handling fails when focused element is in an
      // overflow: auto container.
      this.dialogElement!.showModal();
    }
    // Avoids dispatching initial state.
    const shouldDispatchAction = changed.get('open') !== undefined;
    this.performTransition(shouldDispatchAction);
  }

  /**
   * Internal state is reflected here as attributes to effect styling. This
   * could be done via internal classes, but it's published on the host
   * to facilitate the (currently undocumented) possibility of customizing
   * styling of user content based on these states.
   * Note, in the future this could be done with `:state(...)` when browser
   * support improves.
   */
  private reflectStateProp(
      changed: PropertyValues, key: string, value: unknown,
      attribute?: string) {
    attribute ??= key;
    if (!changed.has(key)) {
      return;
    }
    if (value) {
      this.setAttribute(attribute, '');
    } else {
      this.removeAttribute(attribute);
    }
  }

  private dialogClosedResolver?: () => void;

  private async performTransition(shouldDispatchAction: boolean) {
    // TODO: pause here only to avoid a double update warning.
    await this.updateComplete;
    // Focus initial element.
    if (this.open) {
      this.focus();
    }
    this.showingOpen = this.open;
    if (shouldDispatchAction) {
      this.dispatchActionEvent(this.open ? 'opening' : 'closing');
    }
    // Compute desired transition duration.
    const duration = msFromTimeCSSValue(
        getComputedStyle(this.containerElement!).transitionDuration);
    let promise = this.updateComplete;
    if (duration > 0) {
      promise = new Promise((r) => {
        setTimeout(r, duration);
      });
    }
    await promise;
    this.opening = false;
    this.closing = false;
    if (!this.open && this.dialogElement?.open) {
      // Closing the dialog triggers an asynchronous `close` event.
      // It's important to wait for this event to fire since it changes the
      // state of `open` to false.
      // Without waiting, this element's `closed` event can be called before
      // the dialog's `close` event, which is problematic since the user
      // can set `open` in the `closed` event.
      // The timing of the event appears to vary via browser and does *not*
      // seem to resolve by "task" timing; therefore an explicit promise is
      // used.
      const closedPromise = new Promise<void>(resolve => {
        this.dialogClosedResolver = resolve;
      });
      this.dialogElement?.close(this.currentAction || this.defaultAction);
      await closedPromise;
    }
    if (shouldDispatchAction) {
      this.dispatchActionEvent(this.open ? 'opened' : 'closed');
    }
    this.currentAction = undefined;
  }

  private dispatchActionEvent(type: string) {
    const detail = {action: this.open ? 'none' : this.currentAction};
    this.dispatchEvent(new CustomEvent(type, {detail, bubbles: true}));
  }

  /* Live media query for matching user specified fullscreen breakpoint. */
  private fullscreenQuery?: MediaQueryList;
  private fullscreenQueryListener:
      ((event: MediaQueryListEvent) => void)|undefined = undefined;
  private updateFullscreen() {
    if (this.fullscreenQuery !== undefined) {
      this.fullscreenQuery.removeEventListener(
          'change', this.fullscreenQueryListener!);
      this.fullscreenQuery = this.fullscreenQueryListener = undefined;
    }
    if (!this.fullscreen) {
      this.showingFullscreen = false;
      return;
    }
    this.fullscreenQuery = window.matchMedia(this.fullscreenBreakpoint);
    this.fullscreenQuery.addEventListener(
        'change',
        (this.fullscreenQueryListener = (event: MediaQueryListEvent) => {
          this.showingFullscreen = event.matches;
        }));
    this.showingFullscreen = this.fullscreenQuery.matches;
  }

  // handles native close/cancel events and we just ensure
  // internal state is in sync.
  private handleDialogDismiss(event: Event) {
    if (event.type === 'cancel') {
      this.currentAction = this.escapeKeyAction;
      // Prevents the <dialog> element from closing when
      // `escapeKeyAction` is set to an empty string.
      // It also early returns and avoids <md-dialog> internal state
      // changes.
      if (this.escapeKeyAction === '') {
        event.preventDefault();
        return;
      }
    }
    this.dialogClosedResolver?.();
    this.dialogClosedResolver = undefined;
    this.open = false;
    this.opening = false;
    this.closing = false;
    redispatchEvent(this, event);
  }

  private handleDialogClick(event: Event) {
    if (!this.open) {
      return;
    }
    this.currentAction =
        (event.target as Element).getAttribute(this.actionAttribute) ??
        (this.containerElement &&
                 !event.composedPath().includes(this.containerElement) ?
             this.scrimClickAction :
             '');
    if (this.currentAction !== '') {
      this.close(this.currentAction);
    }
  }

  /* This allows the dividers to dynamically show based on scrolling. */
  private handleContentScroll() {
    this.throttle('scroll', () => {
      this.requestUpdate();
    });
  }

  private getFocusElement(): HTMLElement|null {
    const selector = `[autofocus]`;
    const slotted = [this.footerSlot, this.contentSlot].flatMap(
        slot => slot.assignedElements({flatten: true}));
    for (const el of slotted) {
      const focusEl = el.matches(selector) ? el : el.querySelector(selector);
      if (focusEl) {
        return focusEl as HTMLElement;
      }
    }
    return null;
  }

  override focus() {
    this.getFocusElement()?.focus();
  }

  override blur() {
    this.getFocusElement()?.blur();
  }
}
