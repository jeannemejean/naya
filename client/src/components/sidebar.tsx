import { Link, useLocation } from "wouter";
import {
  LayoutGrid, Calendar, MessageSquare, BarChart3, Lightbulb,
  Settings, BookOpen, CalendarDays, Rocket, FolderKanban, Layers, Search
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProject } from "@/lib/project-context";
import { useTranslation } from "react-i18next";
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
  { key: 'pilotBoard',      href: "/",                icon: LayoutGrid   },
  { key: 'planning',        href: "/planning",         icon: CalendarDays },
  { key: 'analytics',       href: "/analytics",        icon: BarChart3    },
  { key: 'strategy',        href: "/strategy",         icon: Lightbulb    },
  { key: 'campaigns',       href: "/campaigns",        icon: Rocket       },
  { key: 'contentCalendar', href: "/content-calendar", icon: Calendar     },
  { key: 'outreachCrm',     href: "/outreach",         icon: MessageSquare},
  { key: 'knowledgeHub',    href: "/reading-hub",      icon: BookOpen     },
] as const;

export default function Sidebar({ onSearchClick }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const { activeProjectId, setActiveProjectId, isAllProjects } = useProject();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['/api/projects?limit=200'],
  });

  const currentLang = i18n.language;
  const toggleLanguage = () => i18n.changeLanguage(currentLang === 'fr' ? 'en' : 'fr');
  const userInitial = user?.firstName?.charAt(0) || user?.email?.charAt(0) || "N";

  return (
    <div
      className="w-[64px] flex flex-col h-full"
      style={{
        background: 'var(--sidebar-background)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >

      {/* Logo — N en Cormorant italic, fond or mat */}
      <div className="h-[64px] flex items-center justify-center shrink-0" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <Link href="/">
          <div
            className="w-9 h-9 flex items-center justify-center cursor-pointer"
            style={{ background: 'var(--sidebar-primary)', color: 'var(--sidebar-primary-foreground)', borderRadius: 10 }}
          >
            <span
              style={{
                fontFamily: '"Cormorant Garamond", Georgia, serif',
                fontStyle: 'italic',
                fontWeight: '600',
                fontSize: '1.375rem',
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}
            >
              N
            </span>
          </div>
        </Link>
      </div>

      {/* Search */}
      {onSearchClick && (
        <div className="px-2.5 pt-3 pb-1">
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                onClick={onSearchClick}
                className="w-full h-9 flex items-center justify-center transition-colors duration-150"
                style={{ color: 'var(--sidebar-foreground)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-accent)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Search style={{ width: 15, height: 15 }} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Rechercher</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2.5 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;

          return (
            <Tooltip key={item.key} delayDuration={200}>
              <TooltipTrigger asChild>
                <Link href={item.href}>
                  <button
                    className="relative w-full h-10 flex items-center justify-center transition-colors duration-120"
                    style={{
                      color: isActive
                        ? 'var(--sidebar-primary)'
                        : 'var(--sidebar-foreground)',
                      background: isActive
                        ? 'var(--sidebar-accent)'
                        : 'transparent',
                      borderRadius: 8,
                      borderLeft: isActive
                        ? '2px solid var(--sidebar-primary)'
                        : '2px solid transparent',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-accent)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }
                    }}
                  >
                    <Icon style={{ width: 16, height: 16 }} />
                  </button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(`sidebar.${item.key}`)}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Séparateur */}
        <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '8px 0' }} />

        {/* Projects dropdown */}
        <DropdownMenu>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="relative w-full h-10 flex items-center justify-center transition-colors duration-120"
                  style={{ color: 'var(--sidebar-foreground)', borderLeft: '2px solid transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-accent)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <FolderKanban style={{ width: 16, height: 16 }} />
                  {activeProjectId && (
                    <span
                      className="absolute top-2 right-2 w-1.5 h-1.5"
                      style={{ background: 'var(--sidebar-primary)' }}
                    />
                  )}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.projects')}</TooltipContent>
          </Tooltip>

          <DropdownMenuContent
            side="right"
            align="start"
            className="w-56 ml-2"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <DropdownMenuLabel
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.625rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 300,
                color: 'var(--muted-foreground)',
                padding: '8px 12px 4px',
              }}
            >
              {t('sidebar.projects')}
            </DropdownMenuLabel>
            <DropdownMenuSeparator style={{ background: 'var(--border)' }} />

            <DropdownMenuItem
              onClick={() => setActiveProjectId(null)}
              style={{
                background: isAllProjects ? 'var(--muted)' : 'transparent',
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.75rem',
                fontWeight: 300,
              }}
            >
              <Layers style={{ width: 14, height: 14, marginRight: 8, flexShrink: 0 }} />
              {t('sidebar.allProjects')}
            </DropdownMenuItem>

            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => setActiveProjectId(project.id)}
                style={{
                  background: activeProjectId === project.id ? 'var(--muted)' : 'transparent',
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: '0.75rem',
                  fontWeight: 300,
                }}
              >
                <span
                  className="w-2 h-2 shrink-0 mr-2.5"
                  style={{ background: project.color || 'var(--accent)' }}
                />
                <span className="flex-1 truncate">{project.name}</span>
                {project.isPrimary && (
                  <span style={{ color: 'var(--accent)', fontSize: '0.625rem' }}>◆</span>
                )}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator style={{ background: 'var(--border)' }} />
            <DropdownMenuItem
              onClick={() => navigate('/projects')}
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.75rem',
                fontWeight: 300,
              }}
            >
              <Settings style={{ width: 14, height: 14, marginRight: 8 }} />
              {t('sidebar.manageProjects')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Settings */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <Link href="/settings">
              <button
                className="w-full h-10 flex items-center justify-center transition-colors duration-120"
                style={{
                  color: location === "/settings" ? 'var(--sidebar-primary)' : 'var(--sidebar-foreground)',
                  background: location === "/settings" ? 'var(--sidebar-accent)' : 'transparent',
                  borderLeft: location === "/settings" ? '2px solid var(--sidebar-primary)' : '2px solid transparent',
                }}
                onMouseEnter={e => {
                  if (location !== "/settings") {
                    (e.currentTarget as HTMLElement).style.background = 'var(--sidebar-accent)';
                  }
                }}
                onMouseLeave={e => {
                  if (location !== "/settings") {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                <Settings style={{ width: 16, height: 16 }} />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{t('common.settings')}</TooltipContent>
        </Tooltip>
      </nav>

      {/* Bottom — langue + avatar */}
      <div
        className="py-3 px-2.5 flex flex-col gap-0.5"
        style={{ borderTop: '1px solid var(--sidebar-border)' }}
      >
        {/* Langue */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              onClick={toggleLanguage}
              className="w-full h-9 flex items-center justify-center transition-colors duration-120"
              style={{
                color: 'var(--sidebar-foreground)',
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '0.6rem',
                letterSpacing: '0.12em',
                fontWeight: 300,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-accent)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {currentLang === 'en' ? 'FR' : 'EN'}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {currentLang === 'en' ? 'Passer en français' : 'Switch to English'}
          </TooltipContent>
        </Tooltip>

        {/* Avatar utilisateur */}
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button className="w-full h-9 flex items-center justify-center">
              <div
                className="w-8 h-8 flex items-center justify-center"
                style={{ border: '1px solid var(--sidebar-border)', borderRadius: 8, background: 'var(--sidebar-accent)' }}
              >
                <span
                  style={{
                    fontFamily: '"Cormorant Garamond", Georgia, serif',
                    fontStyle: 'italic',
                    fontWeight: '500',
                    fontSize: '1rem',
                    color: 'var(--sidebar-foreground)',
                    lineHeight: 1,
                  }}
                >
                  {userInitial}
                </span>
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {user?.firstName || user?.email || "Profil"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
