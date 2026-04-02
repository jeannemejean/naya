import { Link, useLocation } from "wouter";
import {
  LayoutGrid, Calendar, MessageSquare, BarChart3, Lightbulb, Settings,
  BookOpen, CalendarDays, Rocket, Moon, Sun, FolderKanban, Layers, Search
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProject } from "@/lib/project-context";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@shared/schema";

interface SidebarProps {
  onSearchClick?: () => void;
}

const NAV_ITEMS = [
  { key: 'pilotBoard',      href: "/",                icon: LayoutGrid,  accent: "text-violet-600",  bg: "bg-violet-50 dark:bg-violet-950/50" },
  { key: 'planning',        href: "/planning",         icon: CalendarDays,accent: "text-blue-600",    bg: "bg-blue-50 dark:bg-blue-950/50" },
  { key: 'analytics',       href: "/analytics",        icon: BarChart3,   accent: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/50" },
  { key: 'strategy',        href: "/strategy",         icon: Lightbulb,   accent: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-950/50" },
  { key: 'campaigns',       href: "/campaigns",        icon: Rocket,      accent: "text-rose-600",    bg: "bg-rose-50 dark:bg-rose-950/50" },
  { key: 'contentCalendar', href: "/content-calendar", icon: Calendar,    accent: "text-indigo-600",  bg: "bg-indigo-50 dark:bg-indigo-950/50" },
  { key: 'outreachCrm',     href: "/outreach",         icon: MessageSquare,accent:"text-cyan-600",   bg: "bg-cyan-50 dark:bg-cyan-950/50" },
  { key: 'knowledgeHub',    href: "/reading-hub",      icon: BookOpen,    accent: "text-teal-600",    bg: "bg-teal-50 dark:bg-teal-950/50" },
] as const;

export default function Sidebar({ onSearchClick }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { activeProjectId, setActiveProjectId, isAllProjects } = useProject();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects?limit=200'],
  });

  const currentLang = i18n.language;
  const toggleLanguage = () => i18n.changeLanguage(currentLang === 'fr' ? 'en' : 'fr');

  const userInitial = user?.firstName?.charAt(0) || user?.email?.charAt(0) || "U";

  return (
    <div className="w-[72px] bg-white dark:bg-[#0D0E12] border-r border-border flex flex-col h-full">

      {/* Logo */}
      <div className="h-[72px] flex items-center justify-center shrink-0">
        <Link href="/">
          <div className="w-10 h-10 bg-gradient-to-br from-[#6C5CE7] to-[#a78bfa] rounded-xl flex items-center justify-center shadow-float cursor-pointer hover:scale-105 transition-transform duration-200">
            <span className="text-white text-base font-black tracking-tight">N</span>
          </div>
        </Link>
      </div>

      {/* Search */}
      {onSearchClick && (
        <div className="px-3 pb-2">
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                onClick={onSearchClick}
                className="w-full h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150"
              >
                <Search className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">Rechercher</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2.5 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;

          return (
            <Tooltip key={item.key} delayDuration={150}>
              <TooltipTrigger asChild>
                <Link href={item.href}>
                  <button
                    className={`relative w-full h-11 rounded-xl flex items-center justify-center transition-all duration-150 ${
                      isActive
                        ? `${item.bg} ${item.accent}`
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {isActive && (
                      <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full ${item.accent.replace('text-', 'bg-')}`} />
                    )}
                    <Icon className="w-[18px] h-[18px]" />
                  </button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium text-xs">
                {t(`sidebar.${item.key}`)}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Divider */}
        <div className="h-px bg-border my-2 mx-1" />

        {/* Projects dropdown */}
        <DropdownMenu>
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="relative w-full h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150">
                  <FolderKanban className="w-[18px] h-[18px]" />
                  {activeProjectId && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
                  )}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium text-xs">
              {t('sidebar.projects')}
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent side="right" align="start" className="w-60 ml-2 shadow-float">
            <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('sidebar.projects')}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => setActiveProjectId(null)}
              className={isAllProjects ? "bg-accent text-accent-foreground" : ""}
            >
              <Layers className="w-4 h-4 mr-2 shrink-0" />
              <span className="font-medium">{t('sidebar.allProjects')}</span>
            </DropdownMenuItem>

            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => setActiveProjectId(project.id)}
                className={activeProjectId === project.id ? "bg-accent text-accent-foreground" : ""}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full mr-2.5 shrink-0"
                  style={{ backgroundColor: project.color || '#6C5CE7' }}
                />
                <span className="text-sm mr-1.5">{project.icon || '📁'}</span>
                <span className="flex-1 truncate">{project.name}</span>
                {project.isPrimary && <span className="text-[10px] text-primary font-semibold">★</span>}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/projects')}>
              <Settings className="w-4 h-4 mr-2" />
              <span>{t('sidebar.manageProjects')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Settings */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <Link href="/settings">
              <button
                className={`w-full h-11 rounded-xl flex items-center justify-center transition-all duration-150 ${
                  location === "/settings"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Settings className="w-[18px] h-[18px]" />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium text-xs">{t('common.settings')}</TooltipContent>
        </Tooltip>
      </nav>

      {/* Bottom */}
      <div className="border-t border-border py-3 px-2.5 space-y-0.5">

        {/* Theme */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              onClick={toggleTheme}
              className="w-full h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium text-xs">
            {theme === 'light' ? t('sidebar.darkMode') : t('sidebar.lightMode')}
          </TooltipContent>
        </Tooltip>

        {/* Language */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              onClick={toggleLanguage}
              className="w-full h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150 text-[11px] font-bold tracking-wider"
            >
              {currentLang === 'en' ? 'FR' : 'EN'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium text-xs">
            {currentLang === 'en' ? 'Passer en français' : 'Switch to English'}
          </TooltipContent>
        </Tooltip>

        {/* User avatar */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button className="w-full h-10 flex items-center justify-center">
              <div className="w-8 h-8 bg-gradient-to-br from-[#6C5CE7] to-[#fd79a8] rounded-full flex items-center justify-center text-white text-xs font-bold shadow-card">
                {userInitial}
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium text-xs">
            {user?.firstName || user?.email || "User"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
