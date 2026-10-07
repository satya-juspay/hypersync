import "server-only";
import { prisma } from "@/lib/prisma";
import { createUiComponentImporter } from "@/lib/ui-component-import-store";

export const uiComponentImporter = createUiComponentImporter(prisma);
