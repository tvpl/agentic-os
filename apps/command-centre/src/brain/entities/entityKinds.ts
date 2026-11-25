/**
 * The four kinds of an entity (.specs/features/cerebro-entidades-resumos, door 2; design.md "Painel da entidade"), each
 * with its icon, and how a key opens the view Entidades: a module of no weight, so the note panel's fold does not pull
 * the view's chunk.
 */
import { FolderKanban, Hash, Quote, User, type LucideIcon } from "lucide-react";

export type EntityKind = "perfil" | "projeto" | "tag" | "termo";
/** The tabs' order (design.md "Vista - Entidades"). */
export const ENTITY_KINDS: readonly EntityKind[] = ["perfil", "projeto", "tag", "termo"];
export const KIND_ICON: Record<EntityKind, LucideIcon> = {
  perfil: User,
  projeto: FolderKanban,
  tag: Hash,
  termo: Quote,
};
/** The search of `/brain/entities` that opens the entity `key`. */
export const entityLink = (key: string) => `?key=${encodeURIComponent(key)}`;
