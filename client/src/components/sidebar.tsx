import { Link, useLocation } from "wouter";
import {
  LayoutGrid, Calendar, MessageSquare, BarChart3, Lightbulb, Settings,
  BookOpen, Layers, CalendarDays, Rocket, Moon, Sun, User, FolderKanban
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

export default function Sidebar({ onSearchClick }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { activeProjectId, setActiveProjectId, isAllProjects } = useProject();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects?limit=200'],
  });

  const navItems = [
    { name: t('sidebar.pilotBoard'), href: "/", icon: LayoutGrid, color: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" },
    { name: t('sidebar.planning'), href: "/planning", icon: CalendarDays, color: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" },
    { name: t('sidebar.analytics'), href: "/analytics", icon: BarChart3, color: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" },
    { name: t('sidebar.strategy'), href: "/strategy", icon: Lightbulb, color: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" },
    { name: t('sidebar.campaigns'), href: "/campaigns", icon: Rocket, color: "bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400" },
    { name: t('sidebar.contentCalendar'), href: "/content-calendar", icon: Calendar, color: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400" },
    { name: t('sidebar.outreachCrm'), href: "/outreach", icon: MessageSquare, color: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400" },
    { name: t('sidebar.knowledgeHub'), href: "/reading-hub", icon: BookOpen, color: "bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400" },
  ];

  const currentLang = i18n.language;
  const toggleLanguage = () => {
    i18n.changeLanguage(currentLang === 'fr' ? 'en' : 'fr');
  };

  return (
    <div className="w-20 bg-white dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full">
      {/* Logo */}
      <div className="h-20 flex items-center justify-center border-b border-gray-200 dark:border-gray-800">
        <Link href="/" className="block cursor-pointer">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg hover:shadow-xl transition-shadow">
            <span className="text-white text-xl font-bold">N</span>
          </div>
        </Link>
      </div>

      {/* Navigation Icons */}
      <div className="flex-1 overflow-y-auto py-6 space-y-2 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;

          return (
            <Tooltip key={item.name} delayDuration={100}>
              <TooltipTrigger asChild>
                <Link href={item.href}>
                  <button
                    className={`w-full h-14 rounded-2xl flex items-center justify-center transition-all duration-200 group relative ${
                      isActive
                        ? `${item.color} shadow-md scale-105`
                        : "hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-400 hover:scale-105"
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${isActive ? '' : 'group-hover:text-gray-900 dark:group-hover:text-gray-200'}`} />
                    {isActive && (
                      <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-purple-500 to-pink-500 rounded-r-full" />
                    )}
                  </button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-none">
                <p className="font-medium">{item.name}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Divider */}
        <div className="h-px bg-gray-200 dark:bg-gray-800 my-4" />

        {/* Projects Dropdown */}
        <DropdownMenu>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-full h-14 rounded-2xl flex items-center justify-center transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-400 hover:scale-105 group relative"
                >
                  <FolderKanban className="w-6 h-6 group-hover:text-gray-900 dark:group-hover:text-gray-200" />
                  {activeProjectId && (
                    <div className="absolute top-1 right-1 w-3 h-3 bg-purple-500 rounded-full border-2 border-white dark:border-gray-950" />
                  )}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-none">
              <p className="font-medium">{t('sidebar.projects')}</p>
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent side="right" align="start" className="w-64 ml-2">
            <DropdownMenuLabel>{t('sidebar.projects')}</DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => setActiveProjectId(null)}
              className={isAllProjects ? "bg-purple-50 dark:bg-purple-900/20" : ""}
            >
              <Layers className="w-4 h-4 mr-3" />
              <span>{t('sidebar.allProjects')}</span>
            </DropdownMenuItem>

            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => setActiveProjectId(project.id)}
                className={activeProjectId === project.id ? "bg-purple-50 dark:bg-purple-900/20" : ""}
              >
                <span
                  className="w-3 h-3 rounded-full mr-3"
                  style={{ backgroundColor: project.color || '#8b5cf6' }}
                />
                <span className="text-base mr-2">{project.icon || '📁'}</span>
                <span className="flex-1">{project.name}</span>
                {project.isPrimary && (
                  <span className="text-xs text-gray-400">★</span>
                )}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => navigate('/projects')}>
              <Settings className="w-4 h-4 mr-3" />
              <span>{t('sidebar.manageProjects')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Settings */}
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Link href="/settings">
              <button
                className={`w-full h-14 rounded-2xl flex items-center justify-center transition-all duration-200 group ${
                  location === "/settings"
                    ? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-md scale-105"
                    : "hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-400 hover:scale-105"
                }`}
              >
                <Settings className={`w-6 h-6 ${location === "/settings" ? '' : 'group-hover:text-gray-900 dark:group-hover:text-gray-200'}`} />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-none">
            <p className="font-medium">{t('common.settings')}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Bottom Actions */}
      <div className="border-t border-gray-200 dark:border-gray-800 py-4 px-3 space-y-2">
        {/* Theme Toggle */}
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button
              onClick={toggleTheme}
              className="w-full h-12 rounded-2xl flex items-center justify-center transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-400 hover:scale-105 group"
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-none">
            <p className="font-medium">{theme === 'light' ? t('sidebar.darkMode') : t('sidebar.lightMode')}</p>
          </TooltipContent>
        </Tooltip>

        {/* Language Toggle */}
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button
              onClick={toggleLanguage}
              className="w-full h-12 rounded-2xl flex items-center justify-center transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-900 text-gray-600 dark:text-gray-400 hover:scale-105 font-semibold text-sm"
            >
              {currentLang === 'en' ? 'FR' : 'EN'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-none">
            <p className="font-medium">{currentLang === 'en' ? 'Passer en français' : 'Switch to English'}</p>
          </TooltipContent>
        </Tooltip>

        {/* User Profile */}
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button className="w-full h-12 rounded-2xl flex items-center justify-center transition-all duration-200 hover:scale-105">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-semibold shadow-md">
                {user?.firstName?.charAt(0) || user?.email?.charAt(0) || "U"}
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-none">
            <p className="font-medium">{user?.firstName || user?.email || "User"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
