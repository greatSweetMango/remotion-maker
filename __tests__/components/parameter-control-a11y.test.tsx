/**
 * @jest-environment jsdom
 *
 * TM-90: a11y unit tests for ParameterControl.
 *
 * TM-80's axe audit reported critical=21 / serious=77, with the dominant
 * categories being:
 *   1. <input type="number"> with no accessible name (ParameterControl range)
 *   2. shadcn <Switch> with no aria-label
 *   3. radix <Slider> thumb with no aria-label
 *   4. text-slate-500 on bg-slate-900 contrast failures
 *
 * These tests assert (a) jest-axe finds no a11y violations, and (b) every
 * interactive control has a programmatic accessible name. The latter is
 * stricter than axe (some controls pass axe via implicit labelling) and
 * guards against regressions where a refactor drops the aria-* attribute.
 */
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { Parameter } from '@/types';

expect.extend(toHaveNoViolations);

// Radix UI primitives need these jsdom polyfills (matches customize-roundtrip.test.tsx).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof Element !== 'undefined' && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import { ParameterControl } from '@/components/studio/ParameterControl';

function Harness({ param, initial }: { param: Parameter; initial: string | number | boolean }) {
  const [val, setVal] = useState(initial);
  return (
    <ParameterControl
      param={param}
      value={val}
      onChange={v => setVal(v)}
    />
  );
}

const rangeParam: Parameter = {
  key: 'speed',
  label: 'Speed',
  type: 'range',
  group: 'timing',
  value: 1,
  min: 0,
  max: 5,
  step: 0.1,
  unit: 'x',
};

const booleanParam: Parameter = {
  key: 'loop',
  label: 'Loop',
  type: 'boolean',
  group: 'other',
  value: true,
};

const textParam: Parameter = {
  key: 'title',
  label: 'Title',
  type: 'text',
  group: 'text',
  value: 'Hello',
};

const selectParam: Parameter = {
  key: 'easing',
  label: 'Easing',
  type: 'select',
  group: 'timing',
  value: 'linear',
  options: ['linear', 'ease-in', 'ease-out'],
};

describe('TM-90 ParameterControl a11y', () => {
  test('range: number input has accessible name + slider thumb labelled', async () => {
    const { container } = render(<Harness param={rangeParam} initial={1} />);

    // Number input: aria-label includes label + unit.
    const numberInput = screen.getByRole('spinbutton');
    expect(numberInput).toHaveAttribute('aria-label', 'Speed value (x)');

    // Slider thumb (radix exposes role=slider on the Thumb).
    const slider = screen.getByRole('slider');
    // labelled via aria-labelledby pointing at the visible <Label>.
    const labelledBy = slider.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).toHaveTextContent('Speed');

    expect(await axe(container)).toHaveNoViolations();
  });

  test('boolean: Switch is labelled', async () => {
    const { container } = render(<Harness param={booleanParam} initial={true} />);
    const sw = screen.getByRole('switch');
    const labelledBy = sw.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).toHaveTextContent('Loop');
    expect(await axe(container)).toHaveNoViolations();
  });

  test('text input has accessible name', async () => {
    const { container } = render(<Harness param={textParam} initial={'Hello'} />);
    const input = screen.getByRole('textbox');
    const labelledBy = input.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).toHaveTextContent('Title');
    expect(await axe(container)).toHaveNoViolations();
  });

  test('select trigger has accessible name', async () => {
    const { container } = render(<Harness param={selectParam} initial={'linear'} />);
    const trigger = screen.getByRole('combobox');
    const labelledBy = trigger.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).toHaveTextContent('Easing');
    // axe sometimes flags Radix Select trigger inside isolated jsdom for
    // missing combobox children (popover not open). Limit to label-related
    // rules so we don't get false positives unrelated to TM-80's findings.
    expect(
      await axe(container, {
        rules: {
          'aria-input-field-name': { enabled: true },
          label: { enabled: true },
          'button-name': { enabled: true },
        },
      }),
    ).toHaveNoViolations();
  });
});
