"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, FileText, Printer } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

export default function SettingsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && (!user || user.role !== "manager")) {
      router.push("/floor-plan")
    }
  }, [user, isLoading, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Chargement...</div>
      </div>
    )
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
            <span className="text-xs sm:text-sm">Retour</span>
          </Button>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-white">Paramètres et Documentation</h1>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">Fonctionnalités disponibles</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl">
        <Card className="bg-slate-800 border-slate-700 mb-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Printer className="h-6 w-6 text-blue-400" />
              <div>
                <CardTitle className="text-white">Imprimantes Epson</CardTitle>
                <CardDescription className="text-slate-400">Configuration centralisée</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-slate-300 text-sm mb-4">
              Les IP et le mode d'impression sont gérés dans un seul onglet admin pour toute l'equipe.
            </p>
            <Button onClick={() => router.push("/admin/printing")} className="bg-blue-600 hover:bg-blue-700 text-white">
              Ouvrir l'onglet Impression
            </Button>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-700 mb-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <FileText className="h-6 w-6 text-blue-400" />
              <div>
                <CardTitle className="text-white">Documentation des fonctionnalités</CardTitle>
                <CardDescription className="text-slate-400">
                  Liste complète des fonctionnalités par rôle
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="admin" className="border-slate-700">
                <AccordionTrigger className="text-white hover:text-blue-400">
                  Fonctionnalités Administrateur
                </AccordionTrigger>
                <AccordionContent className="text-slate-300 space-y-4">
                  <div>
                    <h3 className="font-semibold text-white mb-2">Gestion des commandes</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Prise de commande avec sélection de table</li>
                      <li>Ajout d'articles au panier avec quantités</li>
                      <li>Gestion des suppléments personnalisés (inclus dans le total)</li>
                      <li>Articles offerts avec traçabilité et raison</li>
                      <li>Notes personnalisées par article</li>
                      <li>Gestion des courses (entrée, plat, dessert)</li>
                      <li>Statuts des articles (en attente, à suivre, lancé)</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Encaissement</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Paiement complet ou partiel</li>
                      <li>Division par article avec quantités</li>
                      <li>Remises personnalisées</li>
                      <li>Méthodes de paiement : espèces, carte, autre</li>
                      <li>Impression automatique du ticket de caisse</li>
                      <li>Historique des paiements par commande</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Statistiques et Historique</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Ventes du jour avec montant total</li>
                      <li>TVA collectée (10%)</li>
                      <li>Ticket moyen calculé automatiquement</li>
                      <li>Nombre de commandes</li>
                      <li>Statistiques par serveur avec détails</li>
                      <li>Historique complet de toutes les dates</li>
                      <li>Export CSV des ventes</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Gestion du restaurant</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Création et modification des utilisateurs (serveurs/managers)</li>
                      <li>Gestion des codes PIN</li>
                      <li>Configuration des tables (nom, capacité, position)</li>
                      <li>Éditeur de menu complet (catégories, articles, prix, TVA)</li>
                      <li>Import/Export CSV du menu</li>
                      <li>Gestion des réservations</li>
                      <li>Suivi des articles offerts avec traçabilité</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Impression</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Tickets de cuisine automatiques</li>
                      <li>Tickets de bar automatiques</li>
                      <li>Tickets de caisse avec détails complets</li>
                      <li>Réimpression possible à tout moment</li>
                    </ul>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="server" className="border-slate-700">
                <AccordionTrigger className="text-white hover:text-blue-400">Fonctionnalités Serveur</AccordionTrigger>
                <AccordionContent className="text-slate-300 space-y-4">
                  <div>
                    <h3 className="font-semibold text-white mb-2">Gestion des commandes</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Prise de commande avec sélection de table</li>
                      <li>Ajout d'articles au panier avec quantités</li>
                      <li>Gestion des suppléments personnalisés (inclus dans le total)</li>
                      <li>Articles offerts avec traçabilité et raison</li>
                      <li>Notes personnalisées par article</li>
                      <li>Gestion des courses (entrée, plat, dessert)</li>
                      <li>Statuts des articles (en attente, à suivre, lancé)</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Encaissement</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Paiement complet ou partiel</li>
                      <li>Division par article avec quantités</li>
                      <li>Remises personnalisées</li>
                      <li>Méthodes de paiement : espèces, carte, autre</li>
                      <li>Impression automatique du ticket de caisse</li>
                      <li>Historique des paiements par commande</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Historique (Limité)</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Accès à l'historique du jour en cours</li>
                      <li>Accès à l'historique de la veille uniquement</li>
                      <li>Liste des tables encaissées avec détails</li>
                      <li>Pas d'accès aux statistiques globales</li>
                      <li>Pas d'accès aux statistiques par serveur</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Plan de salle</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Visualisation des tables disponibles/occupées</li>
                      <li>Filtrage par zone (Terrasse, Intérieur, Canapé, Table d'Hôte)</li>
                      <li>Recherche de table par numéro</li>
                      <li>Accès aux réservations</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Impression</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Tickets de cuisine automatiques</li>
                      <li>Tickets de bar automatiques</li>
                      <li>Tickets de caisse avec détails complets</li>
                      <li>Réimpression possible à tout moment</li>
                    </ul>
                  </div>

                  <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 mt-4">
                    <p className="text-yellow-400 text-sm font-semibold">Restrictions serveur :</p>
                    <ul className="list-disc list-inside space-y-1 text-sm text-yellow-300 mt-2">
                      <li>Pas d'accès aux statistiques de ventes</li>
                      <li>Pas d'accès aux statistiques par serveur</li>
                      <li>Historique limité à aujourd'hui et hier</li>
                      <li>Pas d'accès à la gestion des utilisateurs</li>
                      <li>Pas d'accès à la configuration des tables</li>
                      <li>Pas d'accès à l'éditeur de menu</li>
                      <li>Pas d'export de données</li>
                    </ul>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="technical" className="border-slate-700">
                <AccordionTrigger className="text-white hover:text-blue-400">Informations techniques</AccordionTrigger>
                <AccordionContent className="text-slate-300 space-y-4">
                  <div>
                    <h3 className="font-semibold text-white mb-2">Calculs automatiques</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Les suppléments sont inclus dans le montant total de la commande</li>
                      <li>Les articles offerts sont tracés mais n'affectent pas le total</li>
                      <li>La TVA est calculée à 10% sur le total</li>
                      <li>Le ticket moyen est calculé automatiquement (total / nombre de commandes)</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Sécurité</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Authentification par code PIN à 4 chiffres</li>
                      <li>Séparation des rôles (serveur/manager)</li>
                      <li>Traçabilité complète des actions</li>
                      <li>Historique des articles offerts avec raison obligatoire</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-semibold text-white mb-2">Base de données</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Supabase PostgreSQL</li>
                      <li>Synchronisation en temps réel</li>
                      <li>Sauvegarde automatique</li>
                      <li>Historique permanent des ventes</li>
                    </ul>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
