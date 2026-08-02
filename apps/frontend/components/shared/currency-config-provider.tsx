"use client";

import { useEffect, type ReactNode } from "react";
import { useFinancialSettings } from "@/hooks/use-financial";
import { setCurrencyConfig } from "@/lib/utils/format";

/**
 * Seeds the global currency formatter from Financial Management > Settings.
 *
 * The financial settings are fetched once and cached by react-query; as soon as
 * they arrive, `formatCurrency` starts rendering with the academy's configured
 * currency and locale instead of the hard-coded default.
 */
export function CurrencyConfigProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useFinancialSettings();

  useEffect(() => {
    if (settings?.currency && settings?.currency_locale) {
      setCurrencyConfig({ currency: settings.currency, locale: settings.currency_locale });
    }
  }, [settings?.currency, settings?.currency_locale]);

  return <>{children}</>;
}
