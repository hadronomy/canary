use syn::{Attribute, Fields, ItemEnum, Type, Variant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Tag,
    Atom,
}

#[derive(Clone)]
pub struct VariantSpec {
    pub ident: syn::Ident,
    pub role: Role,
    pub payload: Option<Type>,
}

pub struct Input {
    pub item: ItemEnum,
    pub variants: Vec<VariantSpec>,
}

pub fn parse(mut item: ItemEnum) -> syn::Result<Input> {
    let mut variants = Vec::with_capacity(item.variants.len());
    for variant in &mut item.variants {
        variants.push(parse_variant(variant)?);
    }
    Ok(Input { item, variants })
}

fn parse_variant(variant: &mut Variant) -> syn::Result<VariantSpec> {
    let mut role = None;
    let mut attrs = Vec::with_capacity(variant.attrs.len());
    for attr in variant.attrs.drain(..) {
        if attr.path().is_ident("tag") {
            set_role(&mut role, Role::Tag, &attr)?;
            continue;
        }
        if attr.path().is_ident("atom") {
            set_role(&mut role, Role::Atom, &attr)?;
            continue;
        }
        attrs.push(attr);
    }
    variant.attrs = attrs;

    let Some(role) = role else {
        return Err(syn::Error::new_spanned(
            &variant.ident,
            "document node variants must be marked with #[tag] or #[atom]",
        ));
    };

    if let Some((_, expr)) = &variant.discriminant {
        return Err(syn::Error::new_spanned(
            expr,
            "document node variants cannot use explicit discriminants",
        ));
    }

    let payload = payload(&variant.fields)?;
    Ok(VariantSpec { ident: variant.ident.clone(), role, payload })
}

fn set_role(role: &mut Option<Role>, next: Role, attr: &Attribute) -> syn::Result<()> {
    if role.replace(next).is_some() {
        return Err(syn::Error::new_spanned(
            attr,
            "document node variants may only have one of #[tag] or #[atom]",
        ));
    }
    Ok(())
}

fn payload(fields: &Fields) -> syn::Result<Option<Type>> {
    match fields {
        Fields::Unit => Ok(None),
        Fields::Unnamed(fields) if fields.unnamed.len() == 1 => {
            Ok(fields.unnamed.first().map(|field| field.ty.clone()))
        }
        Fields::Unnamed(fields) => Err(syn::Error::new_spanned(
            fields,
            "document node tuple variants must contain exactly one payload type",
        )),
        Fields::Named(fields) => Err(syn::Error::new_spanned(
            fields,
            "document node variants must be unit variants or single-field tuple variants",
        )),
    }
}
