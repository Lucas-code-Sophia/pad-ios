"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { ArrowLeft, Target, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function WorldCupAdminHubPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
  }

  if (!user || user.role !== "manager") {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-900 p-3 sm:p-6">
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <Button
            onClick={() => router.push("/admin")}
            variant="outline"
            size="sm"
            className="bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
          >
            <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="text-xs sm:text-sm">Retour admin</span>
          </Button>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Coupe du monde</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Gérez vos jeux événementiels</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-4xl">
        <Card
          className="bg-slate-800 border-slate-700 hover:border-blue-500 transition-colors cursor-pointer"
          onClick={() => router.push("/admin/world-cup/score-exact")}
        >
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-blue-600 rounded-lg">
                <Target className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Score Exact</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Pronostics clients + gagnants</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Créez un match, affichez un QR code, collectez les pronostics puis résolvez le match.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 sm:p-3 bg-amber-600 rounded-lg">
                <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-base sm:text-lg">Jeux à venir</CardTitle>
                <CardDescription className="text-slate-400 text-xs sm:text-sm">Module évolutif</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <p className="text-slate-300 text-xs sm:text-sm">
              Ce bloc pourra accueillir d'autres jeux Coupe du monde ensuite.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
