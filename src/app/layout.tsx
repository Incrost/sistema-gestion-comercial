/**
 * Layout raíz: idioma, tipografía (Geist), estilos globales y los proveedores
 * que comparten TODAS las páginas, incluida /login:
 * - <Toaster>: región aria-live de las notificaciones temporales (src/lib/avisos.ts);
 * - <TooltipProvider>: ayudas emergentes de shadcn/ui.
 * El panel lateral y la barra superior viven en src/app/(protegido)/layout.tsx.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APLICACION } from "@/config/aplicacion";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: APLICACION.nombre, template: `%s · ${APLICACION.nombre}` },
  description: APLICACION.descripcion,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="top-right" closeButton visibleToasts={4} />
      </body>
    </html>
  );
}
