import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { throwApiError, translateError } from "@/lib/api-error";

type AuthDialogProps = {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 defaultTab?: "login" | "register";
};

export default function AuthDialog({ open, onOpenChange, defaultTab = "login" }: AuthDialogProps) {
 const [, setLocation] = useLocation();
 const { toast } = useToast();
 const { t } = useTranslation();
 const [activeTab, setActiveTab] = useState(defaultTab);

 // Login mutation
 const loginMutation = useMutation({
 mutationFn: async (data: { email: string; password: string }) => {
 const res = await fetch("/api/auth/login", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(data),
 credentials: "include",
 });

 if (!res.ok) {
 await throwApiError(res, "login_failed");
 }

 return res.json();
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
 onOpenChange(false);
 setLocation("/");
 toast({
 title: t("auth.welcomeBackTitle"),
 description: t("auth.welcomeBackBody"),
 });
 },
 onError: (error: unknown) => {
 toast({
 title: t("auth.loginFailedTitle"),
 description: translateError(t, error, "login_failed"),
 variant: "destructive",
 });
 },
 });

 // Register mutation
 const registerMutation = useMutation({
 mutationFn: async (data: { email: string; password: string; firstName?: string; lastName?: string }) => {
 const res = await fetch("/api/auth/register", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(data),
 credentials: "include",
 });

 if (!res.ok) {
 await throwApiError(res, "register_failed");
 }

 return res.json();
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
 onOpenChange(false);
 setLocation("/onboarding");
 toast({
 title: t("auth.accountCreatedTitle"),
 description: t("auth.accountCreatedBody"),
 });
 },
 onError: (error: unknown) => {
 toast({
 title: t("auth.registerFailedTitle"),
 description: translateError(t, error, "register_failed"),
 variant: "destructive",
 });
 },
 });

 const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 const formData = new FormData(e.currentTarget);
 loginMutation.mutate({
 email: formData.get("email") as string,
 password: formData.get("password") as string,
 });
 };

 const handleRegister = (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 const formData = new FormData(e.currentTarget);
 registerMutation.mutate({
 email: formData.get("email") as string,
 password: formData.get("password") as string,
 firstName: formData.get("firstName") as string,
 lastName: formData.get("lastName") as string,
 });
 };

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-[425px]">
 <DialogHeader>
 <DialogTitle>Welcome to Naya</DialogTitle>
 <DialogDescription>
 Your AI-powered OS for independent entrepreneurs
 </DialogDescription>
 </DialogHeader>

 <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "login" | "register")}>
 <TabsList className="grid w-full grid-cols-2">
 <TabsTrigger value="login">Login</TabsTrigger>
 <TabsTrigger value="register">Create Account</TabsTrigger>
 </TabsList>

 <TabsContent value="login">
 <form onSubmit={handleLogin} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="login-email">Email</Label>
 <Input
 id="login-email"
 name="email"
 type="email"
 placeholder="you@example.com"
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="login-password">Password</Label>
 <Input
 id="login-password"
 name="password"
 type="password"
 placeholder="••••••••"
 required
 />
 </div>
 <Button
 type="submit"
 className="w-full"
 disabled={loginMutation.isPending}
 >
 {loginMutation.isPending ? "Logging in..." : "Login"}
 </Button>
 </form>
 </TabsContent>

 <TabsContent value="register">
 <form onSubmit={handleRegister} className="space-y-4">
 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label htmlFor="register-firstName">First Name</Label>
 <Input
 id="register-firstName"
 name="firstName"
 placeholder="Jane"
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="register-lastName">Last Name</Label>
 <Input
 id="register-lastName"
 name="lastName"
 placeholder="Doe"
 />
 </div>
 </div>
 <div className="space-y-2">
 <Label htmlFor="register-email">Email</Label>
 <Input
 id="register-email"
 name="email"
 type="email"
 placeholder="you@example.com"
 required
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="register-password">Password</Label>
 <Input
 id="register-password"
 name="password"
 type="password"
 placeholder="••••••••"
 required
 minLength={8}
 />
 <p className="text-xs text-muted-foreground">
 At least 8 characters
 </p>
 </div>
 <Button
 type="submit"
 className="w-full"
 disabled={registerMutation.isPending}
 >
 {registerMutation.isPending ? "Creating account..." : "Create Account"}
 </Button>
 </form>
 </TabsContent>
 </Tabs>
 </DialogContent>
 </Dialog>
 );
}
