import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
 theme: Theme;
 toggleTheme: () => void;
 setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Pas de mode sombre : le thème reste 'light'. L'API est gardée pour les appelants existants.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
 const [theme] = useState<Theme>('light');

 useEffect(() => {
 window.document.documentElement.classList.remove('dark');
 try {
 if (localStorage.getItem('naya-theme') === 'dark') localStorage.removeItem('naya-theme');
 } catch { /* stockage indisponible */ }
 }, []);

 const setTheme = (_t: Theme) => {};
 const toggleTheme = () => {};

 return (
 <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
 {children}
 </ThemeContext.Provider>
 );
}

export function useTheme() {
 const context = useContext(ThemeContext);
 if (context === undefined) {
 throw new Error('useTheme must be used within a ThemeProvider');
 }
 return context;
}