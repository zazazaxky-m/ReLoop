"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Recycle } from "@/components/ui/icons";
import type { HeroSlide } from "@/lib/hero-slides";

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [active, setActive] = useState(0);
  const startX = useRef<number | null>(null);
  const current = slides[active] ?? slides[0];

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(
      () => setActive((index) => (index + 1) % slides.length),
      6500,
    );
    return () => window.clearInterval(timer);
  }, [slides.length]);

  function move(direction: number) {
    setActive((index) => (index + direction + slides.length) % slides.length);
  }

  function finishSwipe(clientX: number) {
    if (startX.current === null) return;
    const distance = clientX - startX.current;
    startX.current = null;
    if (Math.abs(distance) > 45) move(distance > 0 ? -1 : 1);
  }

  return (
    <div
      className="relative w-full"
      onPointerDown={(event) => {
        startX.current = event.clientX;
      }}
      onPointerUp={(event) => finishSwipe(event.clientX)}
      onPointerCancel={() => {
        startX.current = null;
      }}
    >
      <article className="relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] bg-brand-950 shadow-[0_28px_75px_rgba(6,78,59,0.18)] sm:aspect-[5/4.75] sm:rounded-[2.5rem]">
        {slides.map((slide, index) => (
          <div
            key={`${slide.title}-${index}`}
            aria-hidden={index !== active}
            className={`absolute inset-0 transition-[opacity,transform] duration-700 ease-out ${
              index === active
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-[1.03] opacity-0"
            }`}
          >
            {slide.imageUrl ? (
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url("${slide.imageUrl.replaceAll('"', "%22")}")` }}
              />
            ) : (
              <>
                <div className="absolute -right-[17%] -top-[12%] h-[75%] w-[75%] rounded-full border-[4.5rem] border-lime-300 dark:border-lime-300/10 sm:border-[5.5rem]" />
                <div className="absolute -bottom-[31%] -left-[20%] h-[70%] w-[70%] rounded-full border-[4rem] border-emerald-700 dark:border-brand-700/30 sm:border-[5rem]" />
                <div className="absolute left-[12%] top-[15%] flex h-24 w-24 items-center justify-center rounded-[1.75rem] bg-surface text-5xl text-emerald-700 shadow-2xl dark:bg-surface/10 dark:text-brand-300 sm:h-28 sm:w-28 sm:text-6xl">
                  <Recycle />
                </div>
              </>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-brand-950 via-brand-950/45 to-transparent" />
          </div>
        ))}

        <div className="absolute inset-x-0 bottom-0 z-10 p-7 text-white sm:p-9">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
            {current.eyebrow}
          </p>
          <h2 className="mt-3 max-w-lg text-3xl font-black leading-[1.05] tracking-[-0.045em] sm:text-4xl">
            {current.title}
          </h2>
          <div className="mt-4 flex items-end justify-between gap-5">
            <p className="max-w-sm text-sm leading-6 text-white/65">
              {current.description}
            </p>
            <Link
              href={current.href}
              aria-label={`Buka: ${current.title}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime-300 text-xl text-brand-950 transition-transform hover:scale-105 dark:bg-lime-400"
            >
              <ArrowRight />
            </Link>
          </div>
        </div>
      </article>

      {slides.length > 1 ? (
        <div className="mt-4 flex items-center justify-between px-1">
          <div className="flex gap-2">
            {slides.map((slide, index) => (
              <button
                key={`${slide.title}-dot`}
                type="button"
                aria-label={`Tampilkan slide ${index + 1}`}
                onClick={() => setActive(index)}
                className={`h-2 rounded-full transition-all ${
                  active === index
                    ? "w-8 bg-brand-700 dark:bg-brand-500"
                    : "w-2 bg-brand-950/15 hover:bg-brand-950/30 dark:bg-brand-100/15 dark:hover:bg-brand-100/30"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Slide sebelumnya"
              onClick={() => move(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm hover:bg-surface-soft"
            >
              <ArrowRight className="rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Slide berikutnya"
              onClick={() => move(1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm hover:bg-surface-soft"
            >
              <ArrowRight />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
