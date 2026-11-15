/**
 * Registro ÚNICO de los módulos de Chart.js que usa el tablero (RF-T2).
 *
 * Chart.js v4 se importa por partes: cada tipo de elemento, escala y
 * complemento debe registrarse antes de dibujar. Se hace al evaluar este
 * módulo, que ocurre una sola vez por carga de la aplicación, y no en cada
 * render de los componentes. Lo importan solo componentes cliente.
 */
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

export { ChartJS };

// Estilo común de los gráficos, acorde a la identidad visual (src/app/globals.css).
ChartJS.defaults.color = "#5b6075";
ChartJS.defaults.borderColor = "#e3e5ee";
ChartJS.defaults.font.family = "Geist, ui-sans-serif, system-ui, sans-serif";
