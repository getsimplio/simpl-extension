type SimpleStepperProps = {
  current: number;
  total: number;
};

export function SimpleStepper({ current, total }: SimpleStepperProps) {
  return (
    <div className="simple-stepper" aria-label={`Step ${current} of ${total}`}>
      <span className="simple-stepper__label">
        Step {current} of {total}
      </span>

      {Array.from({ length: total }).map((_, index) => {
        const step = index + 1;

        return (
          <span
            key={step}
            className={
              step === current
                ? "simple-stepper__dot simple-stepper__dot--active"
                : "simple-stepper__dot"
            }
          />
        );
      })}
    </div>
  );
}