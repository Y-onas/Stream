import React, { useState, useEffect } from 'react';

/**
 * AnimatedCounter counts smoothly up to a numeric value or formats currency/strings
 */
export default function AnimatedCounter({ 
  value, 
  duration = 900, 
  prefix = '', 
  suffix = '', 
  decimals = 0,
  formatter
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    // If value is a string with numbers e.g. "€25,550", parse it
    let targetNum = typeof value === 'number' 
      ? value 
      : parseFloat(String(value).replace(/[^0-9.-]+/g, '')) || 0;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(targetNum);
      return;
    }

    let startTime = null;
    let animationFrame;

    const startValue = 0;

    const animate = (currentTime) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      
      // easeOutExpo
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = startValue + (targetNum - startValue) * ease;

      setDisplayValue(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration]);

  if (formatter) {
    return <span>{formatter(displayValue)}</span>;
  }

  // Format as integer or with decimals, add commas
  const formatted = displayValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

