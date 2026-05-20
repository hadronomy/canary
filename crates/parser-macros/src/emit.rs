use proc_macro2::TokenStream;
use quote::quote;

use crate::input::{Input, Role, VariantSpec};

pub fn emit(input: Input) -> TokenStream {
    let item = input.item;
    let vis = &item.vis;

    let all = input.variants.iter().collect::<Vec<_>>();
    let tags =
        input.variants.iter().filter(|variant| variant.role == Role::Tag).collect::<Vec<_>>();
    let atoms =
        input.variants.iter().filter(|variant| variant.role == Role::Atom).collect::<Vec<_>>();

    let node_kind = all.iter().map(|variant| &variant.ident);
    let tag_kind = tags.iter().map(kind_variant);
    let tag_end = tags.iter().map(end_variant);
    let tag_kind_arms = tags.iter().map(|variant| {
        let ident = &variant.ident;
        let pat = unit_or_payload(variant, quote!(Self::#ident), quote!(Self::#ident(..)));
        quote!(#pat => NodeKind::#ident,)
    });
    let tag_end_arms = tags.iter().map(|variant| {
        let ident = &variant.ident;
        quote!(Self::#ident => NodeKind::#ident,)
    });
    let tag_end_from_tag = tags.iter().map(|variant| {
        let ident = &variant.ident;
        let pat = unit_or_payload(variant, quote!(Self::#ident), quote!(Self::#ident(..)));
        quote!(#pat => TagEnd::#ident,)
    });

    let atom_kind = atoms.iter().map(kind_variant);
    let atom_kind_arms = atoms.iter().map(|variant| {
        let ident = &variant.ident;
        let pat = unit_or_payload(variant, quote!(Self::#ident), quote!(Self::#ident(..)));
        quote!(#pat => NodeKind::#ident,)
    });

    let node_view = all.iter().map(view_arm);

    quote! {
        #item

        #[derive(Debug, Clone, Copy, PartialEq, Eq, ::core::hash::Hash)]
        #vis enum NodeKind {
            #( #node_kind, )*
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #vis enum Tag<'a> {
            #( #tag_kind, )*
        }

        impl Tag<'_> {
            #[must_use]
            pub fn kind(self) -> NodeKind {
                match self {
                    #( #tag_kind_arms )*
                }
            }

            #[must_use]
            pub fn end(self) -> TagEnd {
                match self {
                    #( #tag_end_from_tag )*
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #vis enum TagEnd {
            #( #tag_end, )*
        }

        impl TagEnd {
            #[must_use]
            pub fn kind(self) -> NodeKind {
                match self {
                    #( #tag_end_arms )*
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #vis enum Atom<'a> {
            #( #atom_kind, )*
        }

        impl Atom<'_> {
            #[must_use]
            pub fn kind(self) -> NodeKind {
                match self {
                    #( #atom_kind_arms )*
                }
            }
        }

        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        #vis enum NodeView<'a> {
            Tag(Tag<'a>),
            Atom(Atom<'a>),
        }

        impl NodeView<'_> {
            #[must_use]
            pub fn kind(self) -> NodeKind {
                match self {
                    Self::Tag(tag) => tag.kind(),
                    Self::Atom(atom) => atom.kind(),
                }
            }
        }

        impl DocumentNode {
            #[must_use]
            pub fn kind(&self) -> NodeKind {
                self.view().kind()
            }

            #[must_use]
            pub fn view(&self) -> NodeView<'_> {
                match self {
                    #( #node_view )*
                }
            }
        }
    }
}

fn kind_variant(variant: &&VariantSpec) -> TokenStream {
    let ident = &variant.ident;
    match variant.payload {
        Some(ref payload) => quote!(#ident(&'a #payload)),
        None => quote!(#ident),
    }
}

fn end_variant(variant: &&VariantSpec) -> TokenStream {
    let ident = &variant.ident;
    quote!(#ident)
}

fn view_arm(variant: &&VariantSpec) -> TokenStream {
    let ident = &variant.ident;
    match (variant.role, &variant.payload) {
        (Role::Tag, Some(_)) => quote!(Self::#ident(value) => NodeView::Tag(value.as_tag()),),
        (Role::Tag, None) => quote!(Self::#ident => NodeView::Tag(Tag::#ident),),
        (Role::Atom, Some(_)) => quote!(Self::#ident(value) => NodeView::Atom(value.as_atom()),),
        (Role::Atom, None) => quote!(Self::#ident => NodeView::Atom(Atom::#ident),),
    }
}

fn unit_or_payload(variant: &&VariantSpec, unit: TokenStream, payload: TokenStream) -> TokenStream {
    if variant.payload.is_some() { payload } else { unit }
}
