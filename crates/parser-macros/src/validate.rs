use crate::input::Input;

pub fn validate(input: Input) -> syn::Result<Input> {
    if !input.item.generics.params.is_empty() || input.item.generics.where_clause.is_some() {
        return Err(syn::Error::new_spanned(
            &input.item.generics,
            "document_nodes does not support generic enums",
        ));
    }

    if input.item.ident != "DocumentNode" {
        return Err(syn::Error::new(
            input.item.ident.span(),
            "document_nodes currently expects the enum to be named DocumentNode",
        ));
    }

    Ok(input)
}
