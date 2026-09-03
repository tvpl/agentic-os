import { useContext } from "react";
import { I18nContext, type Lang } from "../i18n";

/** Current UI language (for `timeAgo` and number formatting inside shell components). */
export function useI18nLang(): Lang {
  return useContext(I18nContext).lang;
}
