import { X, Clock, Calendar, Paperclip, MessageSquare, Download, Eye, Share2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface TaskDetailPanelProps {
 task: {
 id: number;
 title: string;
 description?: string;
 priority?: string;
 scheduledTime?: string;
 estimatedDuration?: number;
 category?: string;
 completed?: boolean;
 projectColor?: string;
 projectName?: string;
 scheduledDate?: string;
 attachments?: Array<{ name: string; url: string; type: string; date: string }>;
 comments?: Array<{ author: string; text: string; date: string; avatar?: string }>;
 } | null;
 open: boolean;
 onClose: () => void;
}

const priorityColors = {
 high: "bg-[rgba(158,126,135,0.20)] text-[#5c3d45] border-[rgba(158,126,135,0.35)]",
 medium: "bg-[rgba(212,201,122,0.20)] text-[#5a4f0d] border-[rgba(212,201,122,0.35)]",
 low: "bg-naya-olive-10 text-naya-olive border-naya-olive-18",
};

export function TaskDetailPanel({ task, open, onClose }: TaskDetailPanelProps) {
 const [newComment, setNewComment] = useState("");
 const [activeTab, setActiveTab] = useState<"comments" | "updates">("comments");

 if (!task) return null;

 const priorityColor = task.priority ? priorityColors[task.priority as keyof typeof priorityColors] : priorityColors.medium;

 return (
 <>
 {/* Backdrop */}
 <div
 className={cn(
 "fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300",
 open ? "opacity-100" : "opacity-0 pointer-events-none"
 )}
 onClick={onClose}
 />

 {/* Panel */}
 <div
 className={cn(
 "fixed top-0 right-0 h-full w-full md:w-[600px] bg-white shadow-panel z-50",
 "transform transition-transform duration-300 ease-out overflow-hidden flex flex-col",
 open ? "translate-x-0" : "translate-x-full"
 )}
 >
 {/* Header */}
 <div className="border-b border-naya-olive-18 p-6 flex-shrink-0">
 <div className="flex items-start justify-between mb-4">
 <div className="flex items-center gap-3">
 <Button
 variant="ghost"
 size="icon"
 onClick={onClose}
 className="h-9 w-9 rounded-lg"
 >
 <X className="h-5 w-5" />
 </Button>
 <div>
 <Badge variant="outline" className="text-xs mb-1">
 {task.projectName || 'Project'}
 </Badge>
 <h2 className="text-xl font-bold text-foreground leading-tight">
 {task.title}
 </h2>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg">
 <Share2 className="h-4 w-4" />
 </Button>
 <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg">
 <MoreHorizontal className="h-4 w-4" />
 </Button>
 </div>
 </div>

 {/* Priority & Category */}
 <div className="flex items-center gap-2">
 {task.priority && (
 <Badge className={cn("text-xs font-medium", priorityColor)}>
 {task.priority === 'high' ? 'High Priority' : task.priority === 'medium' ? 'Medium Priority' : 'Low Priority'}
 </Badge>
 )}
 {task.category && (
 <Badge variant="outline" className="text-xs">
 {task.category}
 </Badge>
 )}
 </div>
 </div>

 {/* Content */}
 <div className="flex-1 overflow-y-auto">
 {/* Time Spent */}
 <div className="p-6 bg-[rgba(158,126,135,0.12)] border-b border-naya-olive-18 ">
 <div className="flex items-center gap-2 text-sm">
 <Clock className="w-4 h-4 text-[#5c3d45] " />
 <span className="font-semibold text-foreground ">Time Spent on this project</span>
 <span className="ml-auto text-2xl font-bold text-[#5c3d45] ">12:45:00</span>
 </div>
 </div>

 {/* Description */}
 <div className="p-6 border-b border-naya-olive-18 ">
 <h3 className="text-sm font-semibold text-foreground mb-3">Description</h3>
 <p className="text-sm text-naya-olive-55 leading-relaxed whitespace-pre-wrap">
 {task.description || "No description provided."}
 </p>
 </div>

 {/* Metadata */}
 <div className="p-6 border-b border-naya-olive-18 space-y-3">
 {task.scheduledDate && (
 <div className="flex items-center gap-3">
 <Calendar className="w-4 h-4 text-naya-olive-35" />
 <span className="text-sm text-naya-olive-55 ">
 {new Date(task.scheduledDate).toLocaleDateString('en-US', {
 weekday: 'long',
 month: 'long',
 day: 'numeric',
 })}
 </span>
 </div>
 )}
 {task.scheduledTime && (
 <div className="flex items-center gap-3">
 <Clock className="w-4 h-4 text-naya-olive-35" />
 <span className="text-sm text-naya-olive-55 ">
 {task.scheduledTime}
 {task.estimatedDuration && ` · ${task.estimatedDuration} min`}
 </span>
 </div>
 )}
 </div>

 {/* Attachments */}
 {task.attachments && task.attachments.length > 0 && (
 <div className="p-6 border-b border-naya-olive-18 ">
 <h3 className="text-sm font-semibold text-foreground mb-4">Attachments</h3>
 <div className="space-y-3">
 {task.attachments.map((attachment, idx) => (
 <div
 key={idx}
 className="flex items-center gap-3 p-3 rounded-lg bg-naya-olive-06 hover:bg-naya-olive-10 :bg-naya-olive transition-colors group"
 >
 <div className={cn(
 "w-10 h-10 rounded-lg flex items-center justify-center",
 attachment.type === 'pdf' ? "bg-[rgba(158,126,135,0.20)] " : "bg-[rgba(158,126,135,0.20)] "
 )}>
 <Paperclip className={cn(
 "w-5 h-5",
 attachment.type === 'pdf' ? "text-[#5c3d45] " : "text-[#5c3d45] "
 )} />
 </div>
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground truncate">
 {attachment.name}
 </p>
 <p className="text-xs text-naya-cream0 ">{attachment.date}</p>
 </div>
 <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
 <Button variant="ghost" size="icon" className="h-8 w-8">
 <Eye className="h-4 w-4" />
 </Button>
 <Button variant="ghost" size="icon" className="h-8 w-8">
 <Download className="h-4 w-4" />
 </Button>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Comments Section */}
 <div className="p-6">
 {/* Tabs */}
 <div className="flex items-center gap-4 mb-4 border-b border-naya-olive-18 ">
 <button
 onClick={() => setActiveTab("comments")}
 className={cn(
 "pb-3 text-sm font-medium transition-colors relative",
 activeTab === "comments"
 ? "text-foreground "
 : "text-naya-cream0 hover:text-naya-olive-70 :text-naya-olive-18"
 )}
 >
 Comments
 {activeTab === "comments" && (
 <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-naya-olive" />
 )}
 </button>
 <button
 onClick={() => setActiveTab("updates")}
 className={cn(
 "pb-3 text-sm font-medium transition-colors relative",
 activeTab === "updates"
 ? "text-foreground "
 : "text-naya-cream0 hover:text-naya-olive-70 :text-naya-olive-18"
 )}
 >
 Updates
 {activeTab === "updates" && (
 <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-naya-olive" />
 )}
 </button>
 </div>

 {/* Comments List */}
 {activeTab === "comments" && (
 <div className="space-y-4">
 {task.comments && task.comments.length > 0 ? (
 task.comments.map((comment, idx) => (
 <div key={idx} className="flex gap-3">
 <div className="w-8 h-8 rounded-full bg-naya-olive flex items-center justify-center text-naya-cream text-sm font-medium flex-shrink-0">
 {comment.avatar || comment.author.charAt(0)}
 </div>
 <div className="flex-1">
 <div className="flex items-baseline gap-2 mb-1">
 <span className="text-sm font-semibold text-foreground ">
 {comment.author}
 </span>
 <span className="text-xs text-naya-cream0 ">
 {comment.date}
 </span>
 </div>
 <p className="text-sm text-naya-olive-55 ">{comment.text}</p>
 </div>
 </div>
 ))
 ) : (
 <p className="text-sm text-naya-cream0 text-center py-8">
 No comments yet. Be the first to comment!
 </p>
 )}
 </div>
 )}

 {activeTab === "updates" && (
 <div className="text-sm text-naya-cream0 text-center py-8">
 No updates yet.
 </div>
 )}
 </div>
 </div>

 {/* Footer - Add Comment */}
 <div className="border-t border-naya-olive-18 p-6 flex-shrink-0 bg-naya-olive-06 ">
 <div className="flex gap-3">
 <Textarea
 placeholder="Add a comment..."
 value={newComment}
 onChange={(e) => setNewComment(e.target.value)}
 className="min-h-[60px] resize-none rounded-lg border-naya-olive-18 "
 />
 <Button
 size="icon"
 className="h-[60px] w-[60px] rounded-lg bg-naya-olive hover:opacity-90 flex-shrink-0"
 >
 <MessageSquare className="h-5 w-5" />
 </Button>
 </div>
 </div>
 </div>
 </>
 );
}
